import { FeatureGraph, GraphNode } from "./types.js";
import { detectCycle } from "./keystone.js";

export interface BlockerExplanation {
  ticket: string; // identifier
  title: string;
  upstream: string[]; // identifiers that transitively block it
  downstream: string[]; // identifiers it transitively unblocks
  summary: string;
  found: boolean;
  inCycle: boolean;
}

export function explainBlockers(
  graph: FeatureGraph,
  ticketKey: string
): BlockerExplanation {
  const node = resolve(graph, ticketKey);
  if (!node) {
    return {
      ticket: ticketKey,
      title: "",
      upstream: [],
      downstream: [],
      summary: `Ticket ${ticketKey} not found in graph.`,
      found: false,
      inCycle: false,
    };
  }

  const toIdents = (ids: Set<string>) =>
    [...ids].map((id) => graph.nodes.get(id)!.identifier).sort();
  const upstream = toIdents(walk(graph, node.id, graph.predecessors));
  const downstream = toIdents(walk(graph, node.id, graph.successors));

  const inCycle = detectCycle(graph, [...graph.nodes.keys()]).includes(node.id);

  let summary = `${node.identifier} is blocked by ${upstream.length} ticket(s) and unblocks ${downstream.length} ticket(s).`;
  if (inCycle) {
    summary += ` ⚠ Participates in a dependency cycle — resolve it before scheduling.`;
  }

  return {
    ticket: node.identifier,
    title: node.title,
    upstream,
    downstream,
    summary,
    found: true,
    inCycle,
  };
}

function resolve(graph: FeatureGraph, key: string): GraphNode | undefined {
  if (graph.nodes.has(key)) return graph.nodes.get(key);
  for (const n of graph.nodes.values()) if (n.identifier === key) return n;
  return undefined;
}

function walk(
  graph: FeatureGraph,
  start: string,
  adj: Map<string, Set<string>>
): Set<string> {
  const seen = new Set<string>();
  const stack = [...(adj.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) stack.push(m);
  }
  return seen;
}
