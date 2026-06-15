import { GraphCache } from "../cache.js";

export interface ToolResult {
  text: string;
  structured: unknown;
}

export async function buildFeatureGraphTool(
  cache: GraphCache,
  projectId: string
): Promise<ToolResult> {
  const g = await cache.rebuild(projectId);
  return {
    text: `Built feature graph for ${projectId}: ${g.nodes.size} issues, ${g.edges.length} blocking edges.`,
    structured: { nodes: g.nodes.size, edges: g.edges.length },
  };
}
