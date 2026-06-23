import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/scope/tokenize.js";

describe("tokenize", () => {
  it("splits camelCase and lowercases", () => {
    expect(tokenize("econMonteCarloEngine")).toEqual(["econ", "monte", "carlo", "engine"]);
  });
  it("splits snake and kebab and paths", () => {
    expect(tokenize("governance-attacker_agent")).toEqual(["governance", "attacker", "agent"]);
  });
  it("drops stopwords, short tokens, and pure numbers", () => {
    expect(tokenize("add the 42 to src/foo.ts")).toEqual(["foo"]);
  });
  it("returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});
