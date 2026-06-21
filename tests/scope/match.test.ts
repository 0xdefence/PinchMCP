import { describe, it, expect } from "vitest";
import { KeywordMatcher } from "../../src/scope/match.js";
import { CodeIndex } from "../../src/scope/types.js";

const index: CodeIndex = {
  docs: new Map([
    ["src/agents/simulator.ts", ["common", "simulator", "econ", "agents"]],
    ["src/agents/attacker.ts", ["common", "attacker", "governance", "agents"]],
    ["src/util.ts", ["common", "helper"]],
  ]),
  df: new Map([
    ["common", 3], ["agents", 2], ["simulator", 1], ["econ", 1],
    ["attacker", 1], ["governance", 1], ["helper", 1],
  ]),
  fileCount: 3,
};

describe("KeywordMatcher", () => {
  it("ranks the file sharing a distinctive term first", () => {
    const m = new KeywordMatcher().score(["econ", "simulator"], index);
    expect(m[0].file).toBe("src/agents/simulator.ts");
    expect(m[0].matchedTerms).toEqual(expect.arrayContaining(["simulator", "econ"]));
  });

  it("does not match a file sharing only a ubiquitous term", () => {
    const m = new KeywordMatcher().score(["common"], index);
    expect(m).toEqual([]);
  });

  it("returns at most topK results", () => {
    const m = new KeywordMatcher(1).score(["agents"], index);
    expect(m.length).toBeLessThanOrEqual(1);
  });

  it("still matches in a single-file repo (guard would otherwise reject all)", () => {
    const single = {
      docs: new Map([["only.ts", ["foo", "bar"]]]),
      df: new Map([["foo", 1], ["bar", 1]]),
      fileCount: 1,
    };
    const m = new KeywordMatcher().score(["foo"], single);
    expect(m).toHaveLength(1);
    expect(m[0].file).toBe("only.ts");
  });
});
