import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (id: string, identifier: string): Issue => ({
  id,
  identifier,
  title: `Title ${identifier}`,
  state: "Todo",
  estimate: null,
  branchName: null,
});

describe("buildFeatureGraph", () => {
  it("creates a node per issue", () => {
    const g = buildFeatureGraph([issue("a", "ENG-1"), issue("b", "ENG-2")], []);
    expect(g.nodes.size).toBe(2);
    expect(g.nodes.get("a")!.identifier).toBe("ENG-1");
  });

  it("normalizes 'blocks' to a from->to edge", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [{ type: "blocks", fromIssueId: "a", toIssueId: "b" }]
    );
    expect(g.edges).toEqual([{ from: "a", to: "b" }]);
    expect([...g.successors.get("a")!]).toEqual(["b"]);
    expect([...g.predecessors.get("b")!]).toEqual(["a"]);
  });

  it("normalizes 'blocked_by' by swapping direction", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [{ type: "blocked_by", fromIssueId: "a", toIssueId: "b" }]
    );
    // a is blocked by b => b unblocks a => edge b->a
    expect(g.edges).toEqual([{ from: "b", to: "a" }]);
  });

  it("de-duplicates equivalent edges", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [
        { type: "blocks", fromIssueId: "a", toIssueId: "b" },
        { type: "blocks", fromIssueId: "a", toIssueId: "b" },
      ]
    );
    expect(g.edges).toHaveLength(1);
  });

  it("keeps related/duplicate as metadata, not flow edges", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [{ type: "related", fromIssueId: "a", toIssueId: "b" }]
    );
    expect(g.edges).toHaveLength(0);
    expect([...g.relatedMeta.get("a")!]).toEqual(["b"]);
    expect([...g.relatedMeta.get("b")!]).toEqual(["a"]);
  });

  it("ignores edges referencing issues outside the project", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1")],
      [{ type: "blocks", fromIssueId: "a", toIssueId: "ghost" }]
    );
    expect(g.edges).toHaveLength(0);
  });

  it("ignores self-edges", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1")],
      [{ type: "blocks", fromIssueId: "a", toIssueId: "a" }]
    );
    expect(g.edges).toHaveLength(0);
  });

  it("de-duplicates blocks + blocked_by describing the same dependency", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [
        { type: "blocks", fromIssueId: "a", toIssueId: "b" },
        { type: "blocked_by", fromIssueId: "b", toIssueId: "a" },
      ]
    );
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toEqual({ from: "a", to: "b" });
  });

  it("treats duplicate relations as metadata like related", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [{ type: "duplicate", fromIssueId: "a", toIssueId: "b" }]
    );
    expect(g.edges).toHaveLength(0);
    expect([...g.relatedMeta.get("a")!]).toEqual(["b"]);
    expect([...g.relatedMeta.get("b")!]).toEqual(["a"]);
  });

  it("threads prNumbers onto the graph node", () => {
    const g = buildFeatureGraph(
      [{ id: "a", identifier: "ENG-1", title: "t", state: "Todo", estimate: null, branchName: null, prNumbers: [44] }],
      []
    );
    expect(g.nodes.get("a")!.prNumbers).toEqual([44]);
  });

  it("defaults node prNumbers to [] when the issue has none", () => {
    const g = buildFeatureGraph([issue("a", "ENG-1")], []);
    expect(g.nodes.get("a")!.prNumbers).toEqual([]);
  });
});
