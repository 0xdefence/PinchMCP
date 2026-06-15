import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { rankKeystones } from "../../src/graph/keystone.js";
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

const top = (ids: string[], rels: Relation[]) =>
  rankKeystones(buildFeatureGraph(ids.map(issue), rels)).ranked[0];

describe("rankKeystones", () => {
  it("ranks the head of a chain highest", () => {
    // a -> b -> c -> d
    const r = top(["a", "b", "c", "d"], [blocks("a", "b"), blocks("b", "c"), blocks("c", "d")]);
    expect(r.id).toBe("a");
    expect(r.leverage).toBe(3);
  });

  it("identifies a bottleneck as keystone even when other tickets precede it", () => {
    // a -> x, b -> x, x -> c, x -> d, x -> e
    // x is the dominator of c,d,e even though a and b come first.
    const ranking = rankKeystones(
      buildFeatureGraph(
        ["a", "b", "x", "c", "d", "e"].map(issue),
        [blocks("a", "x"), blocks("b", "x"), blocks("x", "c"), blocks("x", "d"), blocks("x", "e")]
      )
    );
    const x = ranking.ranked.find((e) => e.id === "x")!;
    const a = ranking.ranked.find((e) => e.id === "a")!;
    expect(ranking.ranked[0].id).toBe("x");
    expect(x.leverage).toBe(3); // dominates c, d, e
    // a reaches x,c,d,e (4 nodes) but dominates none — proves dominators != reachability
    expect(a.leverage).toBe(0);
    expect(a.reachable).toBe(4);
  });

  it("gives a diamond's apex full leverage", () => {
    // a -> b, a -> c, b -> d, c -> d
    const r = top(["a", "b", "c", "d"], [blocks("a", "b"), blocks("a", "c"), blocks("b", "d"), blocks("c", "d")]);
    expect(r.id).toBe("a");
    expect(r.leverage).toBe(3); // dominates b, c, d
  });

  it("reports isolated nodes and emits a no-structure warning when there are no edges", () => {
    const ranking = rankKeystones(buildFeatureGraph(["a", "b"].map(issue), []));
    expect(ranking.isolated.sort()).toEqual(["a", "b"]);
    expect(ranking.warnings.join(" ")).toMatch(/no dependency structure/i);
    expect(ranking.ranked.every((e) => e.leverage === 0)).toBe(true);
  });

  it("detects cycles and still returns a ranking", () => {
    // a -> b -> a
    const ranking = rankKeystones(buildFeatureGraph(["a", "b"].map(issue), [blocks("a", "b"), blocks("b", "a")]));
    expect(ranking.warnings.join(" ")).toMatch(/cycle/i);
    expect(ranking.ranked).toHaveLength(2);
  });

  it("lists dominated tickets by identifier", () => {
    const ranking = rankKeystones(buildFeatureGraph(["a", "b"].map(issue), [blocks("a", "b")]));
    const a = ranking.ranked.find((e) => e.id === "a")!;
    expect(a.dominates).toEqual(["B"]);
  });
});
