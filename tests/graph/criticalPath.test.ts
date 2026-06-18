import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { criticalPath } from "../../src/graph/criticalPath.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (id: string, estimate: number | null): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: `Title ${id}`,
  state: "Todo",
  estimate,
  branchName: null,
});
const blocks = (from: string, to: string): Relation => ({
  type: "blocks",
  fromIssueId: from,
  toIssueId: to,
});

const node = (cp: ReturnType<typeof criticalPath>, id: string) =>
  cp.nodes.find((n) => n.id === id)!;

describe("criticalPath", () => {
  it("sums durations along a chain and marks every node critical", () => {
    // a(2) -> b(3) -> c(1)
    const cp = criticalPath(
      buildFeatureGraph(
        [issue("a", 2), issue("b", 3), issue("c", 1)],
        [blocks("a", "b"), blocks("b", "c")]
      )
    );
    expect(cp.totalDuration).toBe(6);
    expect(cp.path).toEqual(["A", "B", "C"]);
    expect(cp.nodes.every((n) => n.critical)).toBe(true);
  });

  it("computes slack for off-path tickets in a diamond", () => {
    // a(1) -> b(5) -> d(1); a(1) -> c(2) -> d(1). Critical: a,b,d. c has slack.
    const cp = criticalPath(
      buildFeatureGraph(
        [issue("a", 1), issue("b", 5), issue("c", 2), issue("d", 1)],
        [blocks("a", "b"), blocks("a", "c"), blocks("b", "d"), blocks("c", "d")]
      )
    );
    expect(cp.totalDuration).toBe(7);
    expect(cp.path).toEqual(["A", "B", "D"]);
    expect(node(cp, "c").slack).toBe(3);
    expect(node(cp, "c").critical).toBe(false);
    expect(node(cp, "b").slack).toBe(0);
  });

  it("defaults unestimated tickets to duration 1 and reports them", () => {
    // a(null) -> b(null)
    const cp = criticalPath(
      buildFeatureGraph(
        [issue("a", null), issue("b", null)],
        [blocks("a", "b")]
      )
    );
    expect(cp.totalDuration).toBe(2);
    expect(node(cp, "a").duration).toBe(1);
    expect(node(cp, "a").estimated).toBe(false);
    expect(cp.defaulted.sort()).toEqual(["A", "B"]);
    expect(cp.warnings.join(" ")).toMatch(/estimate/i);
  });

  it("warns on a cycle and still returns", () => {
    const cp = criticalPath(
      buildFeatureGraph(
        [issue("a", 1), issue("b", 1)],
        [blocks("a", "b"), blocks("b", "a")]
      )
    );
    expect(cp.warnings.join(" ")).toMatch(/cycle/i);
  });

  it("warns when there is no dependency structure", () => {
    const cp = criticalPath(buildFeatureGraph([issue("a", 3), issue("b", 1)], []));
    expect(cp.warnings.join(" ")).toMatch(/no dependency structure/i);
    // Longest single ticket sets the duration.
    expect(cp.totalDuration).toBe(3);
  });
});
