import { Commit, TicketFiles } from "./types.js";

export interface IssueRef {
  id: string;
  identifier: string;
  branchName: string | null;
  prNumbers?: number[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mapTicketsToFiles(
  commits: Commit[],
  issues: IssueRef[]
): TicketFiles[] {
  return issues.map((iss) => {
    // Identifier matched on a word boundary so ELI-22 != ELI-220.
    const patterns: RegExp[] = [
      new RegExp(`\\b${escapeRegExp(iss.identifier)}\\b`, "i"),
    ];
    if (iss.branchName) {
      patterns.push(new RegExp(escapeRegExp(iss.branchName), "i"));
    }
    for (const pr of iss.prNumbers ?? []) {
      patterns.push(new RegExp(`\\(#${pr}\\)`));
    }
    const files = new Set<string>();
    for (const c of commits) {
      if (patterns.some((p) => p.test(c.message))) {
        for (const f of c.files) files.add(f);
      }
    }
    return { issueId: iss.id, identifier: iss.identifier, files: [...files] };
  });
}
