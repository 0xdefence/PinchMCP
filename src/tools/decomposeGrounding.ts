import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { isGitRepo, listSourceFiles } from "../code/git.js";
import { buildCodeIndex } from "../scope/codeIndex.js";
import { tokenize } from "../scope/tokenize.js";
import { KeywordMatcher } from "../scope/match.js";
import { moduleOf } from "../scope/scopeCouple.js";
import { groundFeature, FeatureGrounding } from "../scope/groundFeature.js";
import { TicketScope } from "../scope/types.js";

export async function decomposeGroundingTool(
  cache: GraphCache,
  projectId: string,
  repoPath: string,
  feature: string
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
    return { text: "No source files in the repo to ground against.", structured: { error: "no_source_files" } };
  }

  const index = await buildCodeIndex(repoPath, sourceFiles);
  const matcher = new KeywordMatcher();
  const ticketScopes: TicketScope[] = [...graph.nodes.values()].map((n) => {
    const matches = matcher.score(tokenize(`${n.title} ${n.description ?? ""}`), index);
    return { identifier: n.identifier, title: n.title, matches, modules: [...new Set(matches.map((m) => moduleOf(m.file)))] };
  });

  const grounding = groundFeature(feature, index, ticketScopes, matcher);
  return { text: render(feature, grounding), structured: grounding };
}

function render(feature: string, g: FeatureGrounding): string {
  let text =
    `Grounding for "${feature}" (planning aid — use this to decompose into tickets; pinch does not create them).`;
  if (g.predictedModules.length) {
    text += `\n\nLikely code areas: ${g.predictedModules.join(", ")}`;
  } else {
    text += `\n\nNo strong code-area match (new area, or thin description).`;
  }
  if (g.relatedTickets.length) {
    text +=
      `\n\nRelated existing tickets (avoid duplication; consider linking):\n` +
      g.relatedTickets
        .map((t) => `- ${t.identifier} — shares ${t.sharedModules.join(", ")} (terms: ${t.terms.join(", ")})`)
        .join("\n");
  }
  text += `\n\nNext: propose tickets grounded on the areas above, then create them via the Linear MCP.`;
  return text;
}
