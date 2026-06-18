import { GraphCache } from "../cache.js";
import { criticalPath } from "../graph/criticalPath.js";
import { ToolResult } from "./buildFeatureGraph.js";

export async function criticalPathTool(
  cache: GraphCache,
  projectId: string
): Promise<ToolResult> {
  const g = await cache.getOrBuild(projectId);
  const cp = criticalPath(g);

  const durationOf = new Map(cp.nodes.map((n) => [n.identifier, n.duration]));
  const pathLine = cp.path.length
    ? cp.path.map((id) => `${id} (${durationOf.get(id)})`).join(" → ")
    : "(none — no schedulable tickets)";

  let text =
    `Critical path for ${projectId}: total duration ${cp.totalDuration} unit(s).\n` +
    `Path (zero slack): ${pathLine}`;

  const slackish = cp.nodes
    .filter((n) => !n.critical)
    .sort((a, b) => b.slack - a.slack)
    .slice(0, 8);
  if (slackish.length) {
    const list = slackish.map((n) => `${n.identifier} (slack ${n.slack})`).join(", ");
    text += `\n\nHas buffer (off the critical path): ${list}`;
  }

  if (cp.warnings.length) {
    text += `\n\nWarnings:\n- ${cp.warnings.join("\n- ")}`;
  }

  return { text, structured: cp };
}
