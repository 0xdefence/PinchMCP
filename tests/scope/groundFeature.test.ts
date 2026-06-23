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

  it("relates a ticket sharing a module, even on a different exact file", () => {
    // The feature matches simulation.ts; the ticket matches governance.ts —
    // different files, same module src/agents. Module overlap should relate them.
    const idx: CodeIndex = {
      docs: new Map([
        ["src/agents/governance.ts", ["agents", "governance", "attacker"]],
        ["src/agents/simulation.ts", ["agents", "simulation", "engine"]],
      ]),
      df: new Map([
        ["agents", 2], ["governance", 1], ["attacker", 1],
        ["simulation", 1], ["engine", 1],
      ]),
      fileCount: 2,
    };
    const ticketScopes: TicketScope[] = [
      { identifier: "ELI-29", title: "governance attacker agent", modules: ["src/agents"],
        matches: [{ file: "src/agents/governance.ts", score: 1, matchedTerms: ["governance"] }] },
    ];
    const g = groundFeature("agents simulation engine", idx, ticketScopes, new KeywordMatcher());
    expect(g.relatedTickets.map((t) => t.identifier)).toContain("ELI-29");
    expect(g.relatedTickets[0].sharedModules).toContain("src/agents");
  });
});
