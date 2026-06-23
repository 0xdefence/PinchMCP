import { describe, it, expect } from "vitest";
import { listSourceFiles } from "../../src/code/git.js";
import { buildCodeIndex } from "../../src/scope/codeIndex.js";
import { makeRepo } from "../code/tempRepo.js";

describe("listSourceFiles", () => {
  it("returns tracked source files, excluding tests and non-source", async () => {
    const repo = makeRepo([{ message: "init", files: {
      "src/agents/governanceAttacker.ts": "export class GovernanceAttacker {}",
      "src/util.js": "module.exports = 1;",
      "tests/x.test.ts": "test stuff",
      "README.md": "# docs",
    } }]);
    const files = await listSourceFiles(repo);
    expect(files.sort()).toEqual(["src/agents/governanceAttacker.ts", "src/util.js"]);
  });
});

describe("buildCodeIndex", () => {
  it("indexes path tokens, identifiers, and comment words with df counts", async () => {
    const repo = makeRepo([{ message: "init", files: {
      "src/agents/simulator.ts": "// econ simulation harness\nexport class EconSimulator {}",
      "src/util.ts": "export const helper = 1;",
    } }]);
    const idx = await buildCodeIndex(repo, ["src/agents/simulator.ts", "src/util.ts"]);
    expect(idx.fileCount).toBe(2);
    const simDoc = idx.docs.get("src/agents/simulator.ts")!;
    expect(simDoc).toEqual(expect.arrayContaining(["agents", "simulator", "econ", "harness"]));
    expect(idx.df.get("simulator")).toBe(1);
    expect(idx.df.get("helper")).toBe(1);
  });
});
