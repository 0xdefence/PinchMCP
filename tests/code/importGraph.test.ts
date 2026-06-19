import { describe, it, expect } from "vitest";
import { buildImportGraph } from "../../src/code/importGraph.js";
import { makeRepo } from "./tempRepo.js";

describe("buildImportGraph", () => {
  it("resolves relative imports to repo-relative files", async () => {
    const repo = makeRepo([
      {
        message: "init",
        files: {
          "src/a.ts": `import { b } from "./b";\nimport { c } from "./sub/c.js";`,
          "src/b.ts": `export const b = 1;`,
          "src/sub/c.ts": `export const c = 2;`,
        },
      },
    ]);
    const g = await buildImportGraph(repo, ["src/a.ts", "src/b.ts", "src/sub/c.ts"]);
    expect([...(g.get("src/a.ts") ?? [])].sort()).toEqual([
      "src/b.ts",
      "src/sub/c.ts",
    ]);
  });

  it("resolves a directory import to its index file", async () => {
    const repo = makeRepo([
      {
        message: "init",
        files: {
          "src/a.ts": `import x from "./mod";`,
          "src/mod/index.ts": `export default 1;`,
        },
      },
    ]);
    const g = await buildImportGraph(repo, ["src/a.ts"]);
    expect([...(g.get("src/a.ts") ?? [])]).toEqual(["src/mod/index.ts"]);
  });

  it("ignores package (non-relative) imports", async () => {
    const repo = makeRepo([
      { message: "init", files: { "src/a.ts": `import { z } from "zod";` } },
    ]);
    const g = await buildImportGraph(repo, ["src/a.ts"]);
    expect([...(g.get("src/a.ts") ?? [])]).toEqual([]);
  });

  it("captures require() and dynamic import()", async () => {
    const repo = makeRepo([
      {
        message: "init",
        files: {
          "src/a.ts": `const b = require("./b");\nconst c = await import("./c");`,
          "src/b.ts": `module.exports = 1;`,
          "src/c.ts": `export default 1;`,
        },
      },
    ]);
    const g = await buildImportGraph(repo, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect([...(g.get("src/a.ts") ?? [])].sort()).toEqual(["src/b.ts", "src/c.ts"]);
  });
});
