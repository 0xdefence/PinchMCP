import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { isGitRepo, listSourceFiles } from "../code/git.js";
import { buildCodeIndex } from "../scope/codeIndex.js";
import { tokenize } from "../scope/tokenize.js";
import { KeywordMatcher } from "../scope/match.js";
import { scopeCouple, moduleOf } from "../scope/scopeCouple.js";
import { SuggestScopeResult, TicketScope } from "../scope/types.js";

export async function suggestScopeTool(
  cache: GraphCache,
  projectId: string,
  repoPath: string
): Promise<ToolResult> {
  if (!(await isGitRepo(repoPath))) {
    return {
      text: `${repoPath} is not a git repo (or git is unavailable). Pass repo_path = the local checkout of the project's repo.`,
      structured: { error: "not_a_git_repo", repoPath },
    };
  }

  const graph = await cache.getOrBuild(projectId);
  const sourceFiles = await listSourceFiles(repoPath);
  if (!sourceFiles.length) {
    return {
      text: "No source files found in the repo to match ticket text against.",
      structured: { tickets: [], links: [], warnings: ["no source files"] },
    };
  }

  const index = await buildCodeIndex(repoPath, sourceFiles);
  const matcher = new KeywordMatcher();

  const tickets: TicketScope[] = [...graph.nodes.values()].map((n) => {
    const matches = matcher.score(tokenize(`${n.title} ${n.description ?? ""}`), index);
    return {
      identifier: n.identifier,
      title: n.title,
      matches,
      modules: [...new Set(matches.map((m) => moduleOf(m.file)))],
    };
  });

  const idByIdentifier = new Map(
    [...graph.nodes.values()].map((n) => [n.identifier, n.id])
  );
  const isLinked = (aI: string, bI: string): boolean => {
    const a = idByIdentifier.get(aI);
    const b = idByIdentifier.get(bI);
    if (!a || !b) return false;
    return (
      (graph.successors.get(a)?.has(b) ?? false) ||
      (graph.successors.get(b)?.has(a) ?? false) ||
      (graph.relatedMeta.get(a)?.has(b) ?? false) ||
      (graph.relatedMeta.get(b)?.has(a) ?? false)
    );
  };

  const links = scopeCouple(tickets, isLinked);
  const result: SuggestScopeResult = { tickets, links, warnings: [] };
  return { text: render(result), structured: result };
}

function render(r: SuggestScopeResult): string {
  const withMatch = r.tickets.filter((t) => t.matches.length);
  const noMatch = r.tickets.filter((t) => !t.matches.length).map((t) => t.identifier);

  let text =
    "Predicted scope (planning aid — confirm before acting; not asserted, not used in keystone/critical_path).";

  if (withMatch.length) {
    text +=
      "\n\nLikely code areas per ticket:\n" +
      withMatch
        .map(
          (t) =>
            `- ${t.identifier} "${t.title}" → ${t.modules.join(", ")} (matched: ${[
              ...new Set(t.matches.flatMap((m) => m.matchedTerms)),
            ]
              .slice(0, 6)
              .join(", ")})`
        )
        .join("\n");
  }

  if (r.links.length) {
    text +=
      "\n\nLikely couplings (consider linking in Linear):\n" +
      r.links
        .slice(0, 15)
        .map((l) => `- ${l.a} ↔ ${l.b} (score ${l.score}) — ${l.evidence.join("; ")}`)
        .join("\n");
  }

  if (noMatch.length) {
    text += `\n\nNo confident match for: ${noMatch.join(", ")} (likely new code, or thin ticket text).`;
  }
  return text;
}
