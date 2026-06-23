export type RelationType = "blocks" | "blocked_by" | "related" | "duplicate";

export interface Issue {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  state: string;
  stateType?: string;
  estimate: number | null; // stored, unused this slice
  branchName: string | null; // stored, unused this slice
  assignee?: string | null;
  description?: string;
  prNumbers?: number[]; // GitHub PR numbers from Linear attachments
}

export interface Relation {
  type: RelationType;
  fromIssueId: string; // issue the relation is declared on
  toIssueId: string; // the related issue
}
