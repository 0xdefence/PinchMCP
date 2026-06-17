export interface GraphNode {
  id: string;
  identifier: string;
  title: string;
  state: string;
  estimate: number | null;
  branchName: string | null;
}

export interface Edge {
  from: string; // "from" unblocks "to" (to depends on from)
  to: string;
}

export interface FeatureGraph {
  nodes: Map<string, GraphNode>;
  edges: Edge[];
  successors: Map<string, Set<string>>; // from -> {to}
  predecessors: Map<string, Set<string>>; // to -> {from}
  relatedMeta: Map<string, Set<string>>; // undirected related/duplicate
}

export interface KeystoneEntry {
  id: string;
  identifier: string;
  title: string;
  leverage: number; // size of dominated subtree (gatekept downstream tickets)
  dominates: string[]; // identifiers of dominated tickets
  reachable: number; // transitive descendants in the flow graph (tiebreak)
}

export interface KeystoneRanking {
  ranked: KeystoneEntry[];
  warnings: string[];
  isolated: string[]; // node ids with no blocking edges
}
