// A commit and the files it changed.
export interface Commit {
  hash: string;
  message: string; // full message (subject + body)
  files: string[]; // repo-relative paths changed in this commit
}

// Issue → files it touched (from branchName + commit references).
export interface TicketFiles {
  issueId: string;
  identifier: string;
  files: string[];
}

// Symmetric file↔file co-change counts.
export interface CoChangeMatrix {
  get(a: string, b: string): number; // commits where both files changed
}

// file → the intra-repo files it imports (resolved, repo-relative).
export type ImportGraph = Map<string, Set<string>>;

export type LinkDirection = "undirected" | "a_depends_on_b" | "b_depends_on_a";

export interface LinkSuggestion {
  a: string; // identifier of ticket A
  b: string; // identifier of ticket B
  score: number; // 0..1
  direction: LinkDirection;
  sharedFiles: number;
  importEdges: number;
  coChangeWeight: number;
  evidence: string[];
}

export interface SuggestLinksResult {
  suggestions: LinkSuggestion[];
  unmappedTickets: string[]; // identifiers with no files found
  warnings: string[];
}
