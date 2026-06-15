import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { explainBlockers } from "../../src/graph/blockers.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (id: string): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: `Title ${id}`,
  state: "Todo",
  estimate: null,
  branchName: null,
});
const blocks = (from: string, to: string): Relation => ({
  type: "blocks",
  fromIssueId: from,
  toIssueId: to,
});

// a -> b -> c
const graph = () =>
  buildFeatureGraph(["a", "b", "c"].map(issue), [blocks("a", "b"), blocks("b", "c")]);

describe("explainBlockers", () => {
  it("walks transitive upstream and downstream by Linear id", () => {
    const e = explainBlockers(graph(), "b");
    expect(e.found).toBe(true);
    expect(e.upstream).toEqual(["A"]);
    expect(e.downstream).toEqual(["C"]);
  });

  it("resolves a ticket by identifier too", () => {
    const e = explainBlockers(graph(), "A");
    expect(e.found).toBe(true);
    expect(e.upstream).toEqual([]);
    expect(e.downstream.sort()).toEqual(["B", "C"]);
  });

  it("summarizes counts", () => {
    const e = explainBlockers(graph(), "a");
    expect(e.summary).toMatch(/blocked by 0/i);
    expect(e.summary).toMatch(/unblocks 2/i);
  });

  it("returns found=false for an unknown ticket", () => {
    const e = explainBlockers(graph(), "zzz");
    expect(e.found).toBe(false);
    expect(e.summary).toMatch(/not found/i);
  });
});
