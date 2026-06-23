import { FeatureGraph } from "./types.js";
import { rankKeystones, detectCycle } from "./keystone.js";

export interface GapReport {
  cycles: string[];
  isolated: string[];
  unestimatedKeystones: string[];
  unownedKeystones: string[];
  staleBlockers: string[];
  summary: string;
}

export function findGaps(graph: FeatureGraph): GapReport {
  const nodeIds = [...graph.nodes.keys()];
  const ident = (id: string) => graph.nodes.get(id)!.identifier;

  const ranking = rankKeystones(graph);
  const cycles = detectCycle(graph, nodeIds).map(ident);
  const isolated = ranking.isolated.map(ident);

  const keystones = ranking.ranked.filter((e) => e.leverage > 0);
  const unestimatedKeystones = keystones
    .filter((e) => graph.nodes.get(e.id)!.estimate == null)
    .map((e) => e.identifier);
  const unownedKeystones = keystones
    .filter((e) => !graph.nodes.get(e.id)!.assignee)
    .map((e) => e.identifier);

  const DONE = new Set(["completed", "canceled"]);
  const staleBlockers: string[] = [];
  for (const id of nodeIds) {
    for (const blocker of graph.predecessors.get(id) ?? []) {
      const b = graph.nodes.get(blocker)!;
      if (b.stateType && DONE.has(b.stateType)) {
        staleBlockers.push(`${ident(id)} (blocked by ${b.identifier}, which is ${b.stateType})`);
      }
    }
  }

  const summary =
    `${cycles.length} cycle member(s), ${isolated.length} isolated, ` +
    `${unestimatedKeystones.length} unestimated keystone(s), ` +
    `${unownedKeystones.length} unowned keystone(s), ` +
    `${staleBlockers.length} stale blocker(s).`;

  return { cycles, isolated, unestimatedKeystones, unownedKeystones, staleBlockers, summary };
}
