import { describe, it, expect } from "vitest";
import { mapTicketsToFiles } from "../../src/code/ticketMap.js";
import { Commit } from "../../src/code/types.js";

const commit = (message: string, files: string[]): Commit => ({
  hash: message,
  message,
  files,
});

describe("mapTicketsToFiles", () => {
  const commits: Commit[] = [
    commit("ELI-22 add eval baseline", ["src/eval/baseline.ts"]),
    commit("fix(eli-20): validator", ["src/ops/validator.ts"]),
    commit("unrelated change", ["src/misc.ts"]),
    commit("ELI-220 different ticket", ["src/other.ts"]),
  ];

  it("maps an issue by its identifier in commit messages", () => {
    const out = mapTicketsToFiles(commits, [
      { id: "a", identifier: "ELI-22", branchName: null },
    ]);
    expect(out[0].files).toEqual(["src/eval/baseline.ts"]);
  });

  it("does not match a longer identifier (ELI-22 vs ELI-220)", () => {
    const out = mapTicketsToFiles(commits, [
      { id: "a", identifier: "ELI-22", branchName: null },
    ]);
    expect(out[0].files).not.toContain("src/other.ts");
  });

  it("matches by branchName too", () => {
    const out = mapTicketsToFiles(commits, [
      { id: "b", identifier: "ELI-20", branchName: "eli-20-validator" },
    ]);
    expect(out[0].files).toContain("src/ops/validator.ts");
  });

  it("returns an empty file list for an unreferenced issue", () => {
    const out = mapTicketsToFiles(commits, [
      { id: "z", identifier: "ELI-99", branchName: null },
    ]);
    expect(out[0].files).toEqual([]);
  });

  it("maps an issue to files via its attached PR number, with no identifier in the message", () => {
    const cs = [commit("feat: railway architecture (#44)", ["docs/railway.md"])];
    const out = mapTicketsToFiles(cs, [
      { id: "m", identifier: "ELI-36", branchName: null, prNumbers: [44] },
    ]);
    expect(out[0].files).toEqual(["docs/railway.md"]);
  });

  it("does not match a different PR number", () => {
    const cs = [commit("feat: something (#43)", ["a.ts"])];
    const out = mapTicketsToFiles(cs, [
      { id: "m", identifier: "ELI-36", branchName: null, prNumbers: [44] },
    ]);
    expect(out[0].files).toEqual([]);
  });
});
