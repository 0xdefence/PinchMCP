import { CriticalPath, CriticalPathNode, FeatureGraph } from "./types.js";

/**
 * Node-weighted Critical Path Method over the blocking DAG. Each ticket's
 * duration is its estimate (unestimated tickets default to 1). A forward pass
 * computes earliest start/finish, a backward pass computes latest start/finish,
 * and slack = latest − earliest. Zero-slack tickets form the critical path.
 *
 * Cycles make CPM undefined: cycle members are excluded from scheduling and a
 * warning is emitted (the acyclic remainder is still scheduled).
 */
export function criticalPath(graph: FeatureGraph): CriticalPath {
  const nodeIds = [...graph.nodes.keys()];
  const warnings: string[] = [];

  // Durations: estimate, or 1 when unestimated.
  const duration = new Map<string, number>();
  const estimated = new Map<string, boolean>();
  const defaulted: string[] = [];
  for (const id of nodeIds) {
    const est = graph.nodes.get(id)!.estimate;
    const has = typeof est === "number";
    duration.set(id, has ? est! : 1);
    estimated.set(id, has);
    if (!has) defaulted.push(graph.nodes.get(id)!.identifier);
  }
  if (defaulted.length) {
    warnings.push(
      `${defaulted.length} ticket(s) had no estimate and were counted as 1: ${defaulted.join(", ")}.`
    );
  }
  if (graph.edges.length === 0) {
    warnings.push(
      "No dependency structure — the critical path is just the longest single ticket."
    );
  }

  // Topological order (Kahn). Nodes left unscheduled are in a cycle.
  const order = topoSort(graph, nodeIds);
  const scheduled = new Set(order);
  if (order.length < nodeIds.length) {
    const cyc = nodeIds
      .filter((id) => !scheduled.has(id))
      .map((id) => graph.nodes.get(id)!.identifier);
    warnings.push(
      `Cycle detected among: ${cyc.join(", ")}. Those tickets are excluded from the schedule.`
    );
  }

  // Forward pass: earliest start/finish.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    let start = 0;
    for (const p of graph.predecessors.get(id) ?? []) {
      if (scheduled.has(p)) start = Math.max(start, ef.get(p)!);
    }
    es.set(id, start);
    ef.set(id, start + duration.get(id)!);
  }
  const totalDuration = order.reduce((m, id) => Math.max(m, ef.get(id)!), 0);

  // Backward pass: latest finish/start.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    // Starts at the project duration (correct for sinks); lowered by any
    // scheduled successor's latest start.
    let finish = totalDuration;
    for (const s of graph.successors.get(id) ?? []) {
      if (scheduled.has(s)) finish = Math.min(finish, ls.get(s)!);
    }
    lf.set(id, finish);
    ls.set(id, finish - duration.get(id)!);
  }

  const nodes: CriticalPathNode[] = order.map((id) => {
    const n = graph.nodes.get(id)!;
    const slack = ls.get(id)! - es.get(id)!;
    return {
      id,
      identifier: n.identifier,
      title: n.title,
      duration: duration.get(id)!,
      estimated: estimated.get(id)!,
      earliestStart: es.get(id)!,
      earliestFinish: ef.get(id)!,
      latestStart: ls.get(id)!,
      latestFinish: lf.get(id)!,
      slack,
      critical: slack === 0,
    };
  });

  const path = reconstructPath(graph, nodes, es, ef, totalDuration);

  return { totalDuration, path, nodes, defaulted, warnings };
}

function topoSort(graph: FeatureGraph, nodeIds: string[]): string[] {
  const indeg = new Map<string, number>();
  for (const id of nodeIds) indeg.set(id, graph.predecessors.get(id)?.size ?? 0);
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of graph.successors.get(n) ?? []) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  return order;
}

// Walk one zero-slack chain backward from a critical sink to a source.
function reconstructPath(
  graph: FeatureGraph,
  nodes: CriticalPathNode[],
  es: Map<string, number>,
  ef: Map<string, number>,
  totalDuration: number
): string[] {
  const critical = new Set(nodes.filter((n) => n.critical).map((n) => n.id));
  // A critical sink: critical and finishing at the project duration.
  let cur = nodes.find((n) => n.critical && n.earliestFinish === totalDuration)?.id;
  const path: string[] = [];
  while (cur) {
    path.unshift(graph.nodes.get(cur)!.identifier);
    let prev: string | undefined;
    for (const p of graph.predecessors.get(cur) ?? []) {
      if (critical.has(p) && ef.get(p) === es.get(cur)) {
        prev = p;
        break;
      }
    }
    cur = prev;
  }
  return path;
}
