import { describe, it, expect } from "vitest";
import { groundFeature } from "../../src/scope/groundFeature.js";
import { KeywordMatcher } from "../../src/scope/match.js";
import { CodeIndex, TicketScope } from "../../src/scope/types.js";

const index: CodeIndex = {
  docs: new Map([
    ["src/agents/sim.ts", ["agents", "simulator", "econ"]],
    ["src/util.ts", ["helper"]],
  ]),
  df: new Map([["agents", 1], ["simulator", 1], ["econ", 1], ["helper", 1]]),
  fileCount: 2,
};
const scopes: TicketScope[] = [
  { identifier: "ELI-28", title: "econ simulator", modules: ["src/agents"],
    matches: [{ file: "src/agents/sim.ts", score: 1, matchedTerms: ["simulator"] }] },
];

describe("groundFeature", () => {
  it("predicts modules for the feature text and finds related tickets", () => {
    const g = groundFeature("build an econ simulator agent", index, scopes, new KeywordMatcher());
    expect(g.predictedModules).toContain("src/agents");
    expect(g.relatedTickets.map((t) => t.identifier)).toContain("ELI-28");
  });

  it("returns no related tickets when scopes don't overlap", () => {
    const g = groundFeature("unrelated helper utility", index, scopes, new KeywordMatcher());
    expect(g.relatedTickets).toEqual([]);
  });
});
