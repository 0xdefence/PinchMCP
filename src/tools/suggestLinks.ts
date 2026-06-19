import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { isGitRepo, gitLog } from "../code/git.js";
import { mapTicketsToFiles, IssueRef } from "../code/ticketMap.js";
import { buildCoChange } from "../code/coChange.js";
import { buildImportGraph } from "../code/importGraph.js";
import { coupleTickets } from "../code/couple.js";
import { SuggestLinksResult } from "../code/types.js";

const MAX_COMMITS = 2000;

export async function suggestLinksTool(
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
  const issues: IssueRef[] = [...graph.nodes.values()].map((n) => ({
    id: n.id,
    identifier: n.identifier,
    branchName: n.branchName,
  }));

  const raw = await gitLog(repoPath, MAX_COMMITS + 1);
  const truncated = raw.length > MAX_COMMITS;
  const commits = raw.slice(0, MAX_COMMITS);
  const ticketFiles = mapTicketsToFiles(commits, issues);
  const allFiles = [...new Set(ticketFiles.flatMap((t) => t.files))];
  const imports = await buildImportGraph(repoPath, allFiles);
  const coChange = buildCoChange(commits);

  // Already-explicit links (in either direction) shouldn't be re-suggested.
  const idByIdentifier = new Map(
    [...graph.nodes.values()].map((n) => [n.identifier, n.id])
  );
  const linked = (aIdent: string, bIdent: string): boolean => {
    const a = idByIdentifier.get(aIdent);
    const b = idByIdentifier.get(bIdent);
    if (!a || !b) return false;
    return (
      (graph.successors.get(a)?.has(b) ?? false) ||
      (graph.successors.get(b)?.has(a) ?? false) ||
      (graph.relatedMeta.get(a)?.has(b) ?? false) ||
      (graph.relatedMeta.get(b)?.has(a) ?? false)
    );
  };

  const suggestions = coupleTickets(ticketFiles, imports, coChange).filter(
    (s) => !linked(s.a, s.b)
  );

  const unmappedTickets = ticketFiles
    .filter((t) => t.files.length === 0)
    .map((t) => t.identifier);

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      `History scan capped at ${MAX_COMMITS} commits; older coupling may be missed.`
    );
  }

  const result: SuggestLinksResult = { suggestions, unmappedTickets, warnings };
  return { text: render(result), structured: result };
}

function render(r: SuggestLinksResult): string {
  const arrow = (d: string) =>
    d === "a_depends_on_b" ? "→" : d === "b_depends_on_a" ? "←" : "↔";
  let text: string;
  if (!r.suggestions.length) {
    text = "No coupling suggestions found from the code.";
  } else {
    const lines = r.suggestions
      .slice(0, 15)
      .map(
        (s) =>
          `- ${s.a} ${arrow(s.direction)} ${s.b} (score ${s.score}) — ${s.evidence.join("; ")}. Consider linking in Linear.`
      );
    text =
      `Inferred coupling suggestions (confirm before acting — these are not asserted):\n${lines.join("\n")}`;
  }
  if (r.unmappedTickets.length) {
    text += `\n\nNo code found for: ${r.unmappedTickets.join(", ")} (no branch/commit references).`;
  }
  if (r.warnings.length) text += `\n\nWarnings:\n- ${r.warnings.join("\n- ")}`;
  return text;
}
