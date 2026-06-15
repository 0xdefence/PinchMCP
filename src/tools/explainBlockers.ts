import { GraphCache } from "../cache.js";
import { explainBlockers } from "../graph/blockers.js";
import { ToolResult } from "./buildFeatureGraph.js";

export async function explainBlockersTool(
  cache: GraphCache,
  projectId: string,
  ticketId: string
): Promise<ToolResult> {
  const g = await cache.getOrBuild(projectId);
  const e = explainBlockers(g, ticketId);
  if (!e.found) {
    return { text: e.summary, structured: e };
  }

  let text = e.summary;
  if (e.upstream.length) {
    text += `\n\nBlocked by (must finish first): ${e.upstream.join(", ")}`;
  }
  if (e.downstream.length) {
    text += `\n\nUnblocks (downstream): ${e.downstream.join(", ")}`;
  }
  return { text, structured: e };
}
