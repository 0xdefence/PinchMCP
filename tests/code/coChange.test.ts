import { describe, it, expect } from "vitest";
import { buildCoChange } from "../../src/code/coChange.js";
import { Commit } from "../../src/code/types.js";

const commit = (files: string[]): Commit => ({ hash: "h", message: "m", files });

describe("buildCoChange", () => {
  it("counts commits where two files changed together (symmetric)", () => {
    const m = buildCoChange([
      commit(["a.ts", "b.ts"]),
      commit(["a.ts", "b.ts"]),
      commit(["a.ts", "c.ts"]),
    ]);
    expect(m.get("a.ts", "b.ts")).toBe(2);
    expect(m.get("b.ts", "a.ts")).toBe(2);
    expect(m.get("a.ts", "c.ts")).toBe(1);
    expect(m.get("b.ts", "c.ts")).toBe(0);
  });

  it("ignores single-file commits", () => {
    const m = buildCoChange([commit(["solo.ts"])]);
    expect(m.get("solo.ts", "anything.ts")).toBe(0);
  });

  it("skips bulk commits above the file cap", () => {
    const many = Array.from({ length: 50 }, (_, i) => `f${i}.ts`);
    const m = buildCoChange([commit(many)], 40);
    expect(m.get("f0.ts", "f1.ts")).toBe(0);
  });
});
