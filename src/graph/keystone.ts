import { FeatureGraph, KeystoneEntry, KeystoneRanking } from "./types.js";

const ENTRY = "__ENTRY__";

export function rankKeystones(graph: FeatureGraph): KeystoneRanking {
  const nodeIds = [...graph.nodes.keys()];
  const warnings: string[] = [];

  if (graph.nodes.has(ENTRY)) {
    throw new Error(
      'Issue id "__ENTRY__" collides with the internal sentinel used for dominator analysis.'
    );
  }

  const isolated = nodeIds.filter(
    (id) =>
      (graph.successors.get(id)?.size ?? 0) === 0 &&
      (graph.predecessors.get(id)?.size ?? 0) === 0
  );

  if (graph.edges.length === 0) {
    return {
      ranked: nodeIds.map((id) => entryFor(graph, id, [], 0)),
      warnings: ["No dependency structure found (no blocking relations)."],
      isolated,
    };
  }

  const cycleNodes = detectCycle(graph, nodeIds);
  if (cycleNodes.length > 0) {
    warnings.push(
      `Cycle detected among: ${cycleNodes
        .map((id) => graph.nodes.get(id)!.identifier)
        .join(", ")}. Keystone ranking proceeds but may be unreliable.`
    );
  }

  // Flow graph: virtual ENTRY -> every source node (in-degree 0).
  const succ = new Map<string, Set<string>>();
  succ.set(ENTRY, new Set());
  for (const id of nodeIds) succ.set(id, new Set(graph.successors.get(id) ?? []));
  for (const id of nodeIds) {
    if ((graph.predecessors.get(id)?.size ?? 0) === 0) succ.get(ENTRY)!.add(id);
  }

  const idom = computeIdom(ENTRY, succ);

  // Dom-tree children -> dominated lists.
  const domChildren = new Map<string, string[]>();
  for (const [n, d] of idom) {
    if (n === ENTRY) continue;
    if (!domChildren.has(d)) domChildren.set(d, []);
    domChildren.get(d)!.push(n);
  }
  // Dominated lists (descendants in the dom tree), computed iteratively.
  const dominatedList = new Map<string, string[]>();
  const computeDominated = (root: string): string[] => {
    // Post-order via explicit stack so children are finalized before parent.
    const order: string[] = [];
    const stack = [root];
    while (stack.length) {
      const n = stack.pop()!;
      order.push(n);
      for (const c of domChildren.get(n) ?? []) stack.push(c);
    }
    // order is root-first (pre-order, reversed children); process in reverse for post-order.
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      const acc: string[] = [];
      for (const c of domChildren.get(n) ?? []) {
        acc.push(c, ...(dominatedList.get(c) ?? []));
      }
      dominatedList.set(n, acc);
    }
    return dominatedList.get(root) ?? [];
  };
  computeDominated(ENTRY);

  const ranked = nodeIds
    .map((id) => {
      const dominated = dominatedList.get(id) ?? [];
      return entryFor(
        graph,
        id,
        dominated.map((d) => graph.nodes.get(d)!.identifier),
        reachableCount(graph, id)
      );
    })
    .sort((a, b) => b.leverage - a.leverage || b.reachable - a.reachable);

  return { ranked, warnings, isolated };
}

function entryFor(
  graph: FeatureGraph,
  id: string,
  dominates: string[],
  reachable: number
): KeystoneEntry {
  const n = graph.nodes.get(id)!;
  return {
    id,
    identifier: n.identifier,
    title: n.title,
    leverage: dominates.length,
    dominates,
    reachable,
  };
}

// Cooper-Harvey-Kennedy "A Simple, Fast Dominance Algorithm".
function computeIdom(
  entry: string,
  succ: Map<string, Set<string>>
): Map<string, string> {
  const preds = new Map<string, Set<string>>();
  for (const n of succ.keys()) preds.set(n, new Set());
  for (const [u, vs] of succ) for (const v of vs) preds.get(v)!.add(u);

  // Iterative DFS postorder from entry.
  const visited = new Set<string>([entry]);
  const post: string[] = [];
  const stack: Array<[string, Iterator<string>]> = [
    [entry, succ.get(entry)!.values()],
  ];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const next = frame[1].next();
    if (next.done) {
      post.push(frame[0]);
      stack.pop();
    } else if (!visited.has(next.value)) {
      visited.add(next.value);
      stack.push([next.value, (succ.get(next.value) ?? new Set()).values()]);
    }
  }

  const postNum = new Map<string, number>();
  post.forEach((n, i) => postNum.set(n, i)); // entry has the highest number
  const rpo = [...post].reverse(); // entry first

  const idom = new Map<string, string>();
  idom.set(entry, entry);

  const intersect = (a: string, b: string): string => {
    let f1 = a;
    let f2 = b;
    while (f1 !== f2) {
      while (postNum.get(f1)! < postNum.get(f2)!) f1 = idom.get(f1)!;
      while (postNum.get(f2)! < postNum.get(f1)!) f2 = idom.get(f2)!;
    }
    return f1;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rpo) {
      if (b === entry || !visited.has(b)) continue;
      let newIdom: string | undefined;
      for (const p of preds.get(b) ?? []) {
        if (idom.has(p)) newIdom = newIdom === undefined ? p : intersect(p, newIdom);
      }
      if (newIdom !== undefined && idom.get(b) !== newIdom) {
        idom.set(b, newIdom);
        changed = true;
      }
    }
  }
  return idom;
}

function detectCycle(graph: FeatureGraph, nodeIds: string[]): string[] {
  const indeg = new Map<string, number>();
  for (const id of nodeIds) indeg.set(id, graph.predecessors.get(id)?.size ?? 0);
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  let removed = 0;
  while (queue.length) {
    const n = queue.shift()!;
    removed++;
    for (const m of graph.successors.get(n) ?? []) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  if (removed === nodeIds.length) return [];
  return nodeIds.filter((id) => indeg.get(id)! > 0);
}

function reachableCount(graph: FeatureGraph, start: string): number {
  const seen = new Set<string>();
  const stack = [...(graph.successors.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of graph.successors.get(n) ?? []) if (!seen.has(m)) stack.push(m);
  }
  return seen.size;
}
