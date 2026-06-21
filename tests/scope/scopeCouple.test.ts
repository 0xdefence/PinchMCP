import { describe, it, expect } from "vitest";
import { scopeCouple, moduleOf } from "../../src/scope/scopeCouple.js";
import { TicketScope } from "../../src/scope/types.js";

const ts = (identifier: string, files: string[]): TicketScope => ({
  identifier,
  title: identifier,
  matches: files.map((f) => ({ file: f, score: 1, matchedTerms: ["agent"] })),
  modules: [...new Set(files.map(moduleOf))],
});
const noneLinked = () => false;

describe("scopeCouple", () => {
  it("couples tickets that predict the same file (undirected)", () => {
    const out = scopeCouple(
      [ts("ELI-28", ["src/agents/sim.ts"]), ts("ELI-30", ["src/agents/sim.ts"])],
      noneLinked
    );
    expect(out).toHaveLength(1);
    expect(out[0].sharedModules).toEqual(["src/agents"]);
    expect(out[0].evidence.join(" ")).toMatch(/src\/agents/);
  });

  it("does not couple tickets with no shared prediction", () => {
    const out = scopeCouple(
      [ts("ELI-28", ["src/a.ts"]), ts("ELI-30", ["src/b.ts"])],
      noneLinked
    );
    expect(out).toEqual([]);
  });

  it("excludes already-linked pairs", () => {
    const out = scopeCouple(
      [ts("ELI-28", ["src/agents/sim.ts"]), ts("ELI-30", ["src/agents/sim.ts"])],
      (a, b) => (a === "ELI-28" && b === "ELI-30") || (a === "ELI-30" && b === "ELI-28")
    );
    expect(out).toEqual([]);
  });

  it("moduleOf returns the directory", () => {
    expect(moduleOf("src/agents/sim.ts")).toBe("src/agents");
    expect(moduleOf("top.ts")).toBe("top.ts");
  });
});
