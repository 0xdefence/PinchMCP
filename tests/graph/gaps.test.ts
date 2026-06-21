import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { findGaps } from "../../src/graph/gaps.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (id: string, extra: Partial<Issue> = {}): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: `T ${id}`,
  state: "Todo",
  estimate: null,
  branchName: null,
  assignee: null,
  ...extra,
});
const blocks = (from: string, to: string): Relation => ({ type: "blocks", fromIssueId: from, toIssueId: to });

describe("findGaps", () => {
  it("flags cycle members", () => {
    const g = buildFeatureGraph([issue("a"), issue("b")], [blocks("a", "b"), blocks("b", "a")]);
    expect(findGaps(g).cycles.sort()).toEqual(["A", "B"]);
  });

  it("flags isolated tickets", () => {
    const g = buildFeatureGraph([issue("a"), issue("b")], []);
    expect(findGaps(g).isolated.sort()).toEqual(["A", "B"]);
  });

  it("flags a keystone missing an estimate", () => {
    const g = buildFeatureGraph([issue("a"), issue("b")], [blocks("a", "b")]);
    expect(findGaps(g).unestimatedKeystones).toEqual(["A"]);
  });

  it("flags a keystone missing an owner", () => {
    const g = buildFeatureGraph([issue("a"), issue("b")], [blocks("a", "b")]);
    expect(findGaps(g).unownedKeystones).toEqual(["A"]);
  });

  it("reports no gaps for a clean, estimated, owned graph", () => {
    const g = buildFeatureGraph(
      [issue("a", { estimate: 3, assignee: "Ada" }), issue("b", { estimate: 1, assignee: "Bo" })],
      [blocks("a", "b")]
    );
    const r = findGaps(g);
    expect(r.cycles).toEqual([]);
    expect(r.isolated).toEqual([]);
    expect(r.unestimatedKeystones).toEqual([]);
    expect(r.unownedKeystones).toEqual([]);
  });
});
