# Phase II-b — Code Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infer coupling between Linear tickets from the code they touch (shared files, intra-repo imports, git co-change) and surface it through a new `suggest_links` tool as scored, evidence-carrying suggestions — never folded into the keystone/critical-path math.

**Architecture:** A new `src/code/` layer. `git.ts` shells out to `git` for commits+files; `ticketMap.ts` maps each issue to the files it touched (via `branchName` + commit identifier references); `coChange.ts` builds a file↔file co-change matrix; `importGraph.ts` resolves intra-repo relative imports to file→file edges; `couple.ts` scores candidate ticket↔ticket edges from those three signals; `suggestLinks.ts` is the tool handler. The existing `linear/`, `graph/`, and analysis tools are untouched — inferred edges never enter `FeatureGraph`.

**Tech Stack:** Node 22+ (`node:child_process`, `node:fs`), TypeScript ESM (NodeNext, `.js` import suffixes), vitest. **No new runtime dependencies** — the import grapher is a lightweight relative-import resolver, not an external library.

## Global Constraints

- TypeScript ESM, `module`/`moduleResolution` NodeNext — every relative import uses a `.js` suffix.
- `tsconfig.json` has `noEmitOnError` + `types: ["node"]`; the build must stay type-clean.
- The build emits only `src/` (`tsconfig.build.json`); tests live under `tests/`.
- Pure functions take data and return data (no I/O) so they're unit-testable; I/O is confined to `git.ts` (shells `git`) and `importGraph.ts` (reads files).
- Inferred edges are **never** inserted into `FeatureGraph` or consumed by `rank_keystones`/`critical_path`.
- Co-change and shared-file signals are **undirected**; only import edges may imply a direction.
- Run a single test file with `npx vitest run <path>`; the whole suite with `npm test`.

---

## File Structure

```
src/code/
  types.ts         Commit, TicketFiles, CoChangeMatrix, ImportGraph, LinkSuggestion, SuggestLinksResult
  git.ts           isGitRepo, gitLog (+ parseLog) — shells `git`
  ticketMap.ts     mapTicketsToFiles(commits, issues) -> TicketFiles[]
  coChange.ts      buildCoChange(commits) -> CoChangeMatrix
  importGraph.ts   buildImportGraph(repoPath, files) -> Map<file, Set<file>>
  couple.ts        coupleTickets(ticketFiles, imports, coChange, opts) -> LinkSuggestion[]
src/tools/
  suggestLinks.ts  suggestLinksTool(cache, projectId, repoPath) -> ToolResult
src/index.ts       register `suggest_links`
tests/code/        one test file per module (+ a temp-repo helper)
tests/tools/tools.test.ts  add suggest_links handler test
```

---

## Task 1: Types + git plumbing

**Files:**
- Create: `src/code/types.ts`, `src/code/git.ts`
- Create: `tests/code/tempRepo.ts` (test helper), `tests/code/git.test.ts`

**Interfaces:**
- Produces:
  - `interface Commit { hash: string; message: string; files: string[] }`
  - `isGitRepo(repoPath: string): Promise<boolean>`
  - `gitLog(repoPath: string, maxCommits: number): Promise<Commit[]>`
  - `parseLog(stdout: string): Commit[]` (exported for direct unit testing)

- [ ] **Step 1: Create `src/code/types.ts`**

```ts
// A commit and the files it changed.
export interface Commit {
  hash: string;
  message: string; // full message (subject + body)
  files: string[]; // repo-relative paths changed in this commit
}

// Issue → files it touched (from branchName + commit references).
export interface TicketFiles {
  issueId: string;
  identifier: string;
  files: string[];
}

// Symmetric file↔file co-change counts.
export interface CoChangeMatrix {
  get(a: string, b: string): number; // commits where both files changed
}

// file → the intra-repo files it imports (resolved, repo-relative).
export type ImportGraph = Map<string, Set<string>>;

export type LinkDirection = "undirected" | "a_depends_on_b" | "b_depends_on_a";

export interface LinkSuggestion {
  a: string; // identifier of ticket A
  b: string; // identifier of ticket B
  score: number; // 0..1
  direction: LinkDirection;
  sharedFiles: number;
  importEdges: number;
  coChangeWeight: number;
  evidence: string[];
}

export interface SuggestLinksResult {
  suggestions: LinkSuggestion[];
  unmappedTickets: string[]; // identifiers with no files found
  warnings: string[];
}
```

- [ ] **Step 2: Create the test helper `tests/code/tempRepo.ts`**

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// A throwaway git repo for tests. Each commit takes a message + a map of
// repo-relative path -> file contents.
export function makeRepo(
  commits: { message: string; files: Record<string, string> }[]
): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pinch-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  for (const c of commits) {
    for (const [rel, content] of Object.entries(c.files)) {
      const abs = path.join(dir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    git("add", "-A");
    git("commit", "-q", "-m", c.message);
  }
  return dir;
}
```

- [ ] **Step 3: Write the failing test `tests/code/git.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { isGitRepo, gitLog, parseLog } from "../../src/code/git.js";
import { makeRepo } from "./tempRepo.js";
import { tmpdir } from "node:os";

describe("git plumbing", () => {
  it("detects a git repo and rejects a non-repo", async () => {
    const repo = makeRepo([{ message: "init", files: { "a.ts": "1" } }]);
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(tmpdir())).toBe(false);
  });

  it("returns commits with their changed files (newest first)", async () => {
    const repo = makeRepo([
      { message: "ELI-1 first", files: { "src/a.ts": "a" } },
      { message: "ELI-2 second", files: { "src/b.ts": "b", "src/c.ts": "c" } },
    ]);
    const commits = await gitLog(repo, 50);
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toContain("ELI-2");
    expect(commits[0].files.sort()).toEqual(["src/b.ts", "src/c.ts"]);
    expect(commits[1].files).toEqual(["src/a.ts"]);
  });

  it("parseLog splits the record/unit-separated format", () => {
    const out =
      "\x1eh1\x1fmsg one\x1f\nsrc/a.ts\n\x1eh2\x1fmsg two\x1f\nsrc/b.ts\nsrc/c.ts\n";
    const commits = parseLog(out);
    expect(commits).toEqual([
      { hash: "h1", message: "msg one", files: ["src/a.ts"] },
      { hash: "h2", message: "msg two", files: ["src/b.ts", "src/c.ts"] },
    ]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/code/git.test.ts`
Expected: FAIL — cannot find module `git.js`.

- [ ] **Step 5: Write `src/code/git.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Commit } from "./types.js";

const exec = promisify(execFile);

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await exec("git", [
      "-C",
      repoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function gitLog(
  repoPath: string,
  maxCommits: number
): Promise<Commit[]> {
  // Record sep \x1e between commits; unit sep \x1f between hash | message |
  // (then --name-only appends the file list).
  const { stdout } = await exec(
    "git",
    [
      "-C",
      repoPath,
      "log",
      "--all",
      "-n",
      String(maxCommits),
      "--name-only",
      "--pretty=format:%x1e%H%x1f%B%x1f",
    ],
    { maxBuffer: 128 * 1024 * 1024 }
  );
  return parseLog(stdout);
}

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter((r) => r.trim().length > 0)
    .map((record) => {
      const [hash = "", message = "", filesBlock = ""] = record.split("\x1f");
      const files = filesBlock
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return { hash: hash.trim(), message: message.trim(), files };
    });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/code/git.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add src/code/types.ts src/code/git.ts tests/code/tempRepo.ts tests/code/git.test.ts
git commit -m "feat(code): git plumbing + code-layer types"
```

---

## Task 2: Ticket → code mapping

**Files:**
- Create: `src/code/ticketMap.ts`
- Test: `tests/code/ticketMap.test.ts`

**Interfaces:**
- Consumes: `Commit` (Task 1).
- Produces: `mapTicketsToFiles(commits: Commit[], issues: IssueRef[]): TicketFiles[]` where `interface IssueRef { id: string; identifier: string; branchName: string | null }`.

- [ ] **Step 1: Write the failing test `tests/code/ticketMap.test.ts`**

```ts
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
    commit("fix(eli-20): validator", ["src/ops/validator.ts"]), // branchName match
    commit("unrelated change", ["src/misc.ts"]),
    commit("ELI-220 different ticket", ["src/other.ts"]), // must NOT match ELI-22
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
    // "eli-20" appears in the commit message
    expect(out[0].files).toContain("src/ops/validator.ts");
  });

  it("returns an empty file list for an unreferenced issue", () => {
    const out = mapTicketsToFiles(commits, [
      { id: "z", identifier: "ELI-99", branchName: null },
    ]);
    expect(out[0].files).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/code/ticketMap.test.ts`
Expected: FAIL — cannot find module `ticketMap.js`.

- [ ] **Step 3: Write `src/code/ticketMap.ts`**

```ts
import { Commit, TicketFiles } from "./types.js";

export interface IssueRef {
  id: string;
  identifier: string;
  branchName: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mapTicketsToFiles(
  commits: Commit[],
  issues: IssueRef[]
): TicketFiles[] {
  return issues.map((iss) => {
    // Identifier matched on a word boundary so ELI-22 != ELI-220.
    const patterns: RegExp[] = [
      new RegExp(`\\b${escapeRegExp(iss.identifier)}\\b`, "i"),
    ];
    if (iss.branchName) {
      patterns.push(new RegExp(escapeRegExp(iss.branchName), "i"));
    }
    const files = new Set<string>();
    for (const c of commits) {
      if (patterns.some((p) => p.test(c.message))) {
        for (const f of c.files) files.add(f);
      }
    }
    return { issueId: iss.id, identifier: iss.identifier, files: [...files] };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/code/ticketMap.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/code/ticketMap.ts tests/code/ticketMap.test.ts
git commit -m "feat(code): map tickets to files via identifier + branchName"
```

---

## Task 3: Co-change matrix

**Files:**
- Create: `src/code/coChange.ts`
- Test: `tests/code/coChange.test.ts`

**Interfaces:**
- Consumes: `Commit` (Task 1).
- Produces: `buildCoChange(commits: Commit[], maxFilesPerCommit?: number): CoChangeMatrix`. Default `maxFilesPerCommit = 40` (commits touching more files are skipped as bulk/noise).

- [ ] **Step 1: Write the failing test `tests/code/coChange.test.ts`**

```ts
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
    expect(m.get("b.ts", "a.ts")).toBe(2); // symmetric
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/code/coChange.test.ts`
Expected: FAIL — cannot find module `coChange.js`.

- [ ] **Step 3: Write `src/code/coChange.ts`**

```ts
import { Commit, CoChangeMatrix } from "./types.js";

const SEP = "\x00";
const key = (a: string, b: string) => (a < b ? a + SEP + b : b + SEP + a);

export function buildCoChange(
  commits: Commit[],
  maxFilesPerCommit = 40
): CoChangeMatrix {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const files = [...new Set(c.files)].sort();
    if (files.length < 2 || files.length > maxFilesPerCommit) continue;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const k = key(files[i], files[j]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return {
    get(a: string, b: string): number {
      if (a === b) return 0;
      return counts.get(key(a, b)) ?? 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/code/coChange.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/code/coChange.ts tests/code/coChange.test.ts
git commit -m "feat(code): git co-change matrix"
```

---

## Task 4: Import graph (relative-import resolver)

**Files:**
- Create: `src/code/importGraph.ts`
- Test: `tests/code/importGraph.test.ts`

**Interfaces:**
- Produces: `buildImportGraph(repoPath: string, files: string[]): Promise<ImportGraph>` — for each repo-relative file in `files`, the set of intra-repo files it imports (resolved). Non-relative (package) imports are ignored.

- [ ] **Step 1: Write the failing test `tests/code/importGraph.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/code/importGraph.test.ts`
Expected: FAIL — cannot find module `importGraph.js`.

- [ ] **Step 3: Write `src/code/importGraph.ts`**

```ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { ImportGraph } from "./types.js";

// Captures the module specifier in:  from "x" | import "x" | require("x") | import("x")
const SPEC_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`]([^"'`]+)["'`]/g;

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_EXTS = [".ts", ".tsx", ".js", ".jsx"];

// Resolve a relative specifier from `fromFile` (repo-relative) to a repo-relative
// file path, or null if it isn't an intra-repo file.
function resolveImport(
  fromFile: string,
  spec: string,
  repoPath: string
): string | null {
  if (!spec.startsWith(".")) return null;
  const baseAbs = path.resolve(repoPath, path.dirname(fromFile), spec);
  const candidates = [
    baseAbs,
    ...EXTS.map((e) => baseAbs + e),
    ...INDEX_EXTS.map((e) => path.join(baseAbs, "index" + e)),
  ];
  for (const cand of candidates) {
    if (existsSync(cand) && cand.startsWith(path.resolve(repoPath))) {
      const rel = path.relative(repoPath, cand);
      if (!rel.startsWith("..")) return rel.split(path.sep).join("/");
    }
  }
  return null;
}

export async function buildImportGraph(
  repoPath: string,
  files: string[]
): Promise<ImportGraph> {
  const imports: ImportGraph = new Map();
  for (const f of files) {
    let content: string;
    try {
      content = await readFile(path.join(repoPath, f), "utf8");
    } catch {
      imports.set(f, new Set());
      continue;
    }
    const targets = new Set<string>();
    for (const m of content.matchAll(SPEC_RE)) {
      const resolved = resolveImport(f, m[1], repoPath);
      if (resolved && resolved !== f) targets.add(resolved);
    }
    imports.set(f, targets);
  }
  return imports;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/code/importGraph.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/code/importGraph.ts tests/code/importGraph.test.ts
git commit -m "feat(code): intra-repo relative-import graph"
```

---

## Task 5: Couple tickets (scoring)

**Files:**
- Create: `src/code/couple.ts`
- Test: `tests/code/couple.test.ts`

**Interfaces:**
- Consumes: `TicketFiles` (Task 1), `ImportGraph` (Task 1/4), `CoChangeMatrix` (Task 1/3).
- Produces: `coupleTickets(ticketFiles: TicketFiles[], imports: ImportGraph, coChange: CoChangeMatrix, opts?: { minCoChange?: number }): LinkSuggestion[]` — sorted by score desc. Default `minCoChange = 2`.

- [ ] **Step 1: Write the failing test `tests/code/couple.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { coupleTickets } from "../../src/code/couple.js";
import { buildCoChange } from "../../src/code/coChange.js";
import { ImportGraph, TicketFiles } from "../../src/code/types.js";

const tf = (identifier: string, files: string[]): TicketFiles => ({
  issueId: identifier.toLowerCase(),
  identifier,
  files,
});
const noImports: ImportGraph = new Map();
const noCoChange = buildCoChange([]);

describe("coupleTickets", () => {
  it("suggests a link for tickets that share a file (undirected)", () => {
    const out = coupleTickets(
      [tf("ELI-1", ["src/auth.ts"]), tf("ELI-2", ["src/auth.ts"])],
      noImports,
      noCoChange
    );
    expect(out).toHaveLength(1);
    expect(out[0].sharedFiles).toBe(1);
    expect(out[0].direction).toBe("undirected");
    expect(out[0].score).toBeGreaterThan(0);
    expect(out[0].evidence.join(" ")).toMatch(/src\/auth\.ts/);
  });

  it("derives direction from import edges (A imports B => A depends on B)", () => {
    const imports: ImportGraph = new Map([
      ["src/a.ts", new Set(["src/b.ts"])],
    ]);
    const out = coupleTickets(
      [tf("ELI-1", ["src/a.ts"]), tf("ELI-2", ["src/b.ts"])],
      imports,
      noCoChange
    );
    expect(out).toHaveLength(1);
    expect(out[0].importEdges).toBe(1);
    expect(out[0].direction).toBe("a_depends_on_b");
  });

  it("uses co-change above the floor as a signal", () => {
    const coChange = buildCoChange([
      { hash: "h", message: "m", files: ["src/x.ts", "src/y.ts"] },
      { hash: "h", message: "m", files: ["src/x.ts", "src/y.ts"] },
    ]);
    const out = coupleTickets(
      [tf("ELI-1", ["src/x.ts"]), tf("ELI-2", ["src/y.ts"])],
      noImports,
      coChange
    );
    expect(out).toHaveLength(1);
    expect(out[0].coChangeWeight).toBe(2);
  });

  it("does not suggest unrelated tickets (no shared/import, co-change below floor)", () => {
    const out = coupleTickets(
      [tf("ELI-1", ["src/a.ts"]), tf("ELI-2", ["src/z.ts"])],
      noImports,
      noCoChange
    );
    expect(out).toEqual([]);
  });

  it("skips tickets with no mapped files", () => {
    const out = coupleTickets(
      [tf("ELI-1", []), tf("ELI-2", ["src/a.ts"])],
      noImports,
      noCoChange
    );
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/code/couple.test.ts`
Expected: FAIL — cannot find module `couple.js`.

- [ ] **Step 3: Write `src/code/couple.ts`**

```ts
import {
  CoChangeMatrix,
  ImportGraph,
  LinkDirection,
  LinkSuggestion,
  TicketFiles,
} from "./types.js";

// Weighted, bounded contributions → a 0..1 score. Shared files are the
// strongest signal, then imports, then (correlational) co-change.
function scoreOf(shared: number, imports: number, coChange: number): number {
  const s = Math.min(1, shared / 3) * 0.5;
  const im = Math.min(1, imports / 3) * 0.3;
  const cc = Math.min(1, coChange / 5) * 0.2;
  return Math.round((s + im + cc) * 100) / 100;
}

export function coupleTickets(
  ticketFiles: TicketFiles[],
  imports: ImportGraph,
  coChange: CoChangeMatrix,
  opts: { minCoChange?: number } = {}
): LinkSuggestion[] {
  const minCoChange = opts.minCoChange ?? 2;
  const withFiles = ticketFiles.filter((t) => t.files.length > 0);
  const out: LinkSuggestion[] = [];

  for (let i = 0; i < withFiles.length; i++) {
    for (let j = i + 1; j < withFiles.length; j++) {
      const A = withFiles[i];
      const B = withFiles[j];
      const aFiles = new Set(A.files);
      const bFiles = new Set(B.files);

      const shared = A.files.filter((f) => bFiles.has(f));

      let aToB = 0;
      for (const fa of A.files)
        for (const t of imports.get(fa) ?? []) if (bFiles.has(t)) aToB++;
      let bToA = 0;
      for (const fb of B.files)
        for (const t of imports.get(fb) ?? []) if (aFiles.has(t)) bToA++;
      const importEdges = aToB + bToA;

      let cc = 0;
      for (const fa of A.files)
        for (const fb of B.files) if (fa !== fb) cc += coChange.get(fa, fb);

      if (shared.length === 0 && importEdges === 0 && cc < minCoChange) continue;

      const direction: LinkDirection =
        importEdges === 0
          ? "undirected"
          : aToB > bToA
            ? "a_depends_on_b"
            : bToA > aToB
              ? "b_depends_on_a"
              : "undirected";

      const evidence: string[] = [];
      if (shared.length) evidence.push(`share ${shared.length} file(s): ${shared.join(", ")}`);
      if (importEdges) evidence.push(`${importEdges} import edge(s) between their files`);
      if (cc) evidence.push(`co-changed in ${cc} commit(s)`);

      out.push({
        a: A.identifier,
        b: B.identifier,
        score: scoreOf(shared.length, importEdges, cc),
        direction,
        sharedFiles: shared.length,
        importEdges,
        coChangeWeight: cc,
        evidence,
      });
    }
  }

  return out.sort((x, y) => y.score - x.score);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/code/couple.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/code/couple.ts tests/code/couple.test.ts
git commit -m "feat(code): score candidate ticket couplings"
```

---

## Task 6: `suggest_links` tool + registration + docs

**Files:**
- Create: `src/tools/suggestLinks.ts`
- Modify: `src/index.ts` (register `suggest_links`)
- Modify: `tests/tools/tools.test.ts` (add a handler test)
- Modify: `README.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: `GraphCache` (`src/cache.ts`), `ToolResult` (`src/tools/buildFeatureGraph.ts`), all `src/code/*` functions.
- Produces: `suggestLinksTool(cache: GraphCache, projectId: string, repoPath: string): Promise<ToolResult>` and a `SuggestLinksResult` in `structured`.

- [ ] **Step 1: Write the failing test in `tests/tools/tools.test.ts`**

Add this import near the other tool imports:

```ts
import { suggestLinksTool } from "../../src/tools/suggestLinks.js";
```

Add this test inside the `describe("tool handlers", ...)` block. It builds a real temp repo so the git/import path is exercised end to end:

```ts
  it("suggest_links proposes a link for tickets that touch coupled code", async () => {
    const { makeRepo } = await import("../code/tempRepo.js");
    const repo = makeRepo([
      { message: "ENG-1 add auth", files: { "src/auth.ts": `export const a = 1;` } },
      {
        message: "ENG-2 use auth",
        files: { "src/login.ts": `import { a } from "./auth";` },
      },
      // a later commit that changes both, creating co-change + an import edge
      {
        message: "ENG-1 ENG-2 tweak both",
        files: {
          "src/auth.ts": `export const a = 2;`,
          "src/login.ts": `import { a } from "./auth";\n// use ${"a"}`,
        },
      },
    ]);
    // sampleProject uses ENG-1/2/3 identifiers; map them onto this repo.
    const r = await suggestLinksTool(newCache(), "p1", repo);
    expect(r.text).toMatch(/ENG-1/);
    expect(r.text).toMatch(/ENG-2/);
    expect(r.text.toLowerCase()).toMatch(/import|share|co-change/);
  });

  it("suggest_links errors clearly when repo_path is not a git repo", async () => {
    const { tmpdir } = await import("node:os");
    const r = await suggestLinksTool(newCache(), "p1", tmpdir());
    expect(r.text).toMatch(/not a git repo/i);
  });
```

Note: `newCache()` already wraps `StubSource(sampleProject)` whose issues are `ENG-1`, `ENG-2`, `ENG-3` (no `branchName`), so the mapping is driven by the identifiers in the commit messages above.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/tools.test.ts`
Expected: FAIL — cannot find module `suggestLinks.js`.

- [ ] **Step 3: Write `src/tools/suggestLinks.ts`**

```ts
import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { isGitRepo, gitLog } from "../code/git.js";
import { mapTicketsToFiles, IssueRef } from "../code/ticketMap.js";
import { buildCoChange } from "../code/coChange.js";
import { buildImportGraph } from "../code/importGraph.js";
import { coupleTickets } from "../code/couple.js";
import { SuggestLinksResult } from "../code/types.js";

const MAX_COMMITS = 2000;

export async function suggestLinksTool(
  cache: GraphCache,
  projectId: string,
  repoPath: string
): Promise<ToolResult> {
  if (!(await isGitRepo(repoPath))) {
    return {
      text: `${repoPath} is not a git repo (or git is unavailable). Pass repo_path = the local checkout of the project's repo.`,
      structured: { error: "not_a_git_repo", repoPath },
    };
  }

  const graph = await cache.getOrBuild(projectId);
  const issues: IssueRef[] = [...graph.nodes.values()].map((n) => ({
    id: n.id,
    identifier: n.identifier,
    branchName: n.branchName,
  }));

  const commits = await gitLog(repoPath, MAX_COMMITS);
  const ticketFiles = mapTicketsToFiles(commits, issues);
  const allFiles = [...new Set(ticketFiles.flatMap((t) => t.files))];
  const imports = await buildImportGraph(repoPath, allFiles);
  const coChange = buildCoChange(commits);

  // Already-explicit links (in either direction) shouldn't be re-suggested.
  const idByIdentifier = new Map(
    [...graph.nodes.values()].map((n) => [n.identifier, n.id])
  );
  const linked = (aIdent: string, bIdent: string): boolean => {
    const a = idByIdentifier.get(aIdent);
    const b = idByIdentifier.get(bIdent);
    if (!a || !b) return false;
    return (
      (graph.successors.get(a)?.has(b) ?? false) ||
      (graph.successors.get(b)?.has(a) ?? false)
    );
  };

  const suggestions = coupleTickets(ticketFiles, imports, coChange).filter(
    (s) => !linked(s.a, s.b)
  );

  const unmappedTickets = ticketFiles
    .filter((t) => t.files.length === 0)
    .map((t) => t.identifier);

  const warnings: string[] = [];
  if (commits.length === MAX_COMMITS) {
    warnings.push(
      `History scan capped at ${MAX_COMMITS} commits; older coupling may be missed.`
    );
  }

  const result: SuggestLinksResult = { suggestions, unmappedTickets, warnings };
  return { text: render(result), structured: result };
}

function render(r: SuggestLinksResult): string {
  const arrow = (d: string) =>
    d === "a_depends_on_b" ? "→" : d === "b_depends_on_a" ? "←" : "↔";
  let text: string;
  if (!r.suggestions.length) {
    text = "No coupling suggestions found from the code.";
  } else {
    const lines = r.suggestions
      .slice(0, 15)
      .map(
        (s) =>
          `- ${s.a} ${arrow(s.direction)} ${s.b} (score ${s.score}) — ${s.evidence.join("; ")}. Consider linking in Linear.`
      );
    text =
      `Inferred coupling suggestions (confirm before acting — these are not asserted):\n${lines.join("\n")}`;
  }
  if (r.unmappedTickets.length) {
    text += `\n\nNo code found for: ${r.unmappedTickets.join(", ")} (no branch/commit references).`;
  }
  if (r.warnings.length) text += `\n\nWarnings:\n- ${r.warnings.join("\n- ")}`;
  return text;
}
```

- [ ] **Step 4: Register the tool in `src/index.ts`**

Add the import next to the other tool imports:

```ts
import { suggestLinksTool } from "./tools/suggestLinks.js";
```

Add this registration after the `explain_blockers` registration (inside `main`, before `await server.connect(...)`):

```ts
  server.registerTool(
    "suggest_links",
    {
      title: "Suggest missing ticket links from code",
      description:
        "Infer coupling between tickets from the code they touch (shared files, intra-repo imports, git co-change) and suggest links Linear doesn't record. Suggestions only — never asserted; never folded into keystone/critical_path. project_id accepts a name, slug, or UUID; repo_path is the absolute path to the project's local git checkout.",
      inputSchema: {
        project_id: projectId,
        repo_path: z.string().describe("Absolute path to the project's local git checkout"),
      },
    },
    async ({ project_id, repo_path }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await suggestLinksTool(cache, id, repo_path));
    }
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tools/tools.test.ts`
Expected: PASS (the two new tests included).

Then the whole suite + build:

Run: `npm run build && npm test`
Expected: build clean (zero TS errors), all tests pass.

- [ ] **Step 6: Update docs**

In `README.md`, add a row to the tools table:

```
| `suggest_links` | `project_id`, `repo_path` | Infers coupling from code (shared files, intra-repo imports, git co-change) and suggests ticket links Linear doesn't record — evidence-backed, confirm-before-acting. Never folded into keystone/critical_path. |
```

In `docs/ROADMAP.md`, under Phase II-b, change the relevant lines to ✅:

```
- ✅ Ticket → code mapping — via `branchName` + commit/PR references to issue ids
- ✅ Code → code dependency — resolved intra-repo relative-import graph (TS/JS)
- ✅ Git **co-change** matrix — hidden coupling from files that change together
- ✅ `suggest_links` tool — scored candidate ticket↔ticket edges with evidence
```

In `docs/ARCHITECTURE.md`: bump "five tools" → "six tools" (overview + tools section), add `suggest_links` to the tool list, and add a `src/code/` row group to the layers description noting it is read-only (git + file reads) and never mutates `FeatureGraph`.

- [ ] **Step 7: Commit**

```bash
git add src/tools/suggestLinks.ts src/index.ts tests/tools/tools.test.ts README.md docs/ROADMAP.md docs/ARCHITECTURE.md
git commit -m "feat: suggest_links tool — inferred coupling as confirmable suggestions"
```

---

## Self-Review Notes

**Spec coverage** (against `PHASE-II-CODE-GROUNDING.md`):
- Single repo, 1:1, `repo_path` per-call arg → Task 6 tool signature. ✓
- File-level import graph via lightweight TS/JS resolver (SCIP/tree-sitter deferred) → Task 4. ✓
- Git co-change → Task 3. ✓
- Ticket→code via branchName + commit refs → Task 2. ✓
- Scored, conservative, evidence-carrying, undirected-unless-import → Task 5. ✓
- Separate `suggest_links` tool; never folded into keystone/CPM → Task 6 (operates outside `FeatureGraph`; only reads it for identifiers + dedup). ✓
- Edge cases: not-a-git-repo (Task 6), history cap warning (Task 6), unmapped tickets (Task 6), bulk-commit skip (Task 3). ✓
- Testing: temp-repo git tests (Tasks 1,4,6), pure-function unit tests (Tasks 2,3,5). ✓

**Type consistency:** `Commit`, `TicketFiles`, `CoChangeMatrix`, `ImportGraph`, `LinkSuggestion`, `LinkDirection`, `SuggestLinksResult`, `IssueRef` defined in Task 1/2 and used consistently downstream. `ToolResult` reused from `buildFeatureGraph.ts`. `resolveProjectId`, `projectId` (zod) reused from `index.ts`.

**Placeholder scan:** none — every code step is complete; every run step has an expected result.

**Deferred (per spec, intentionally absent):** SCIP/symbol-level, tsconfig path-alias resolution, non-TS/JS languages, multi-repo, cold-start semantic matching, overlay diff, auto-writing links.
