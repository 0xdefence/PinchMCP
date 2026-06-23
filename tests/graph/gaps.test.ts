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

  it("flags a ticket blocked by a completed/canceled ticket", () => {
    const g = buildFeatureGraph(
      [issue("a", { stateType: "completed" }), issue("b")],
      [blocks("a", "b")]
    );
    const sb = findGaps(g).staleBlockers;
    expect(sb).toHaveLength(1);
    expect(sb[0]).toMatch(/B.*A.*completed/);
  });

  it("does not flag a blocker that is still open", () => {
    const g = buildFeatureGraph(
      [issue("a", { stateType: "started" }), issue("b")],
      [blocks("a", "b")]
    );
    expect(findGaps(g).staleBlockers).toEqual([]);
  });
});
