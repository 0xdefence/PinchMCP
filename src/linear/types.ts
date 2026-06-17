export type RelationType = "blocks" | "blocked_by" | "related" | "duplicate";

export interface Issue {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  state: string;
  estimate: number | null; // stored, unused this slice
  branchName: string | null; // stored, unused this slice
}

export interface Relation {
  type: RelationType;
  fromIssueId: string; // issue the relation is declared on
  toIssueId: string; // the related issue
}
