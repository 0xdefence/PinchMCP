import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { findGaps, GapReport } from "../graph/gaps.js";

export async function surfaceGapsTool(
  cache: GraphCache,
  projectId: string
): Promise<ToolResult> {
  const graph = await cache.getOrBuild(projectId);
  if (graph.nodes.size === 0) {
    return { text: "No issues in project.", structured: { issues: 0 } };
  }
  const report = findGaps(graph);
  return { text: render(report), structured: report };
}

function render(r: GapReport): string {
  const sections: string[] = [];
  if (r.staleBlockers.length) {
    sections.push(`Stale blockers (blocker already done — ticket may be ready): ${r.staleBlockers.join("; ")}`);
  }
  if (r.cycles.length) {
    sections.push(`Cycles (must break to schedule): ${r.cycles.join(", ")}`);
  }
  if (r.unestimatedKeystones.length) {
    sections.push(
      `Unestimated keystones (block critical-path planning): ${r.unestimatedKeystones.join(", ")}`
    );
  }
  if (r.unownedKeystones.length) {
    sections.push(
      `Unowned keystones (high leverage, no assignee): ${r.unownedKeystones.join(", ")}`
    );
  }
  if (r.isolated.length) {
    const shown = r.isolated.slice(0, 20).join(", ");
    const tail = r.isolated.length > 20 ? ` … (${r.isolated.length} total)` : "";
    sections.push(
      `Isolated (no recorded dependencies — try suggest_scope/suggest_links): ${shown}${tail}`
    );
  }
  if (!sections.length) return "No gaps found — the graph is clean.";
  return `Graph hygiene: ${r.summary}\n\n${sections.join("\n")}`;
}
