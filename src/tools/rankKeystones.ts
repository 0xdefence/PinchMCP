import { GraphCache } from "../cache.js";
import { rankKeystones } from "../graph/keystone.js";
import { ToolResult } from "./buildFeatureGraph.js";

export async function rankKeystonesTool(
  cache: GraphCache,
  projectId: string
): Promise<ToolResult> {
  const g = await cache.getOrBuild(projectId);
  const ranking = rankKeystones(g);

  const isolatedSet = new Set(ranking.isolated);
  const lines = ranking.ranked
    .filter((e) => !isolatedSet.has(e.id))
    .slice(0, 5)
    .map((e, i) => {
      if (e.leverage > 0) {
        return `${i + 1}. ${e.identifier} "${e.title}" — leverage ${e.leverage}: every path to ${e.dominates.join(", ")} passes through it.`;
      }
      return `${i + 1}. ${e.identifier} "${e.title}" — leverage 0 (gatekeeps nothing downstream).`;
    });

  const body = lines.length
    ? lines.join("\n")
    : "(no tickets gatekeep downstream work)";
  let text = `Keystone ranking for ${projectId}:\n${body}`;
  if (ranking.warnings.length) {
    text += `\n\nWarnings:\n- ${ranking.warnings.join("\n- ")}`;
  }
  if (ranking.isolated.length) {
    const idents = ranking.isolated.map((id) => g.nodes.get(id)!.identifier);
    text += `\n\nUngrounded (no dependency signal): ${idents.join(", ")}`;
  }

  return { text, structured: ranking };
}
