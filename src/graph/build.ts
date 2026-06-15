import { Issue, Relation } from "../linear/types.js";
import { Edge, FeatureGraph, GraphNode } from "./types.js";

export function buildFeatureGraph(
  issues: Issue[],
  relations: Relation[]
): FeatureGraph {
  const nodes = new Map<string, GraphNode>();
  for (const i of issues) {
    nodes.set(i.id, {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      state: i.state,
      estimate: i.estimate,
      branchName: i.branchName,
    });
  }

  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();
  const relatedMeta = new Map<string, Set<string>>();
  for (const id of nodes.keys()) {
    successors.set(id, new Set());
    predecessors.set(id, new Set());
    relatedMeta.set(id, new Set());
  }

  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (from: string, to: string) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to });
    successors.get(from)!.add(to);
    predecessors.get(to)!.add(from);
  };

  for (const r of relations) {
    switch (r.type) {
      case "blocks":
        addEdge(r.fromIssueId, r.toIssueId);
        break;
      case "blocked_by":
        addEdge(r.toIssueId, r.fromIssueId);
        break;
      case "related":
      case "duplicate":
        if (nodes.has(r.fromIssueId) && nodes.has(r.toIssueId)) {
          relatedMeta.get(r.fromIssueId)!.add(r.toIssueId);
          relatedMeta.get(r.toIssueId)!.add(r.fromIssueId);
        }
        break;
    }
  }

  return { nodes, edges, successors, predecessors, relatedMeta };
}
