# Phase II-c — Cold-start semantic matching (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predict which code areas a ticket will likely touch — and which tickets likely couple — from ticket text matched (TF-IDF) against a keyword index of the existing repo, usable before any code lands. New `suggest_scope` tool. Suggestions only; never folded into keystone/CPM.

**Architecture:** New `src/scope/` layer: `tokenize` (split camel/snake/kebab, drop stopwords) → `codeIndex` (per-file token docs + corpus df, source files via `git ls-files`) → `KeywordMatcher` (TF-IDF, behind a `Matcher` seam) → `scopeCouple` (ticket↔ticket from overlapping predictions). `suggest_scope` tool reads ticket title+description from the graph and renders evidence-backed, confirm-before-acting suggestions.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` suffixes), vitest. No new dependencies (no embeddings — deterministic keyword matching).

## Global Constraints

- TS ESM NodeNext; relative imports use `.js`. Build type-clean (`noEmitOnError`, `types:["node"]`).
- New fields (`description?: string`) are **optional** so existing object literals keep compiling; production code populates them, consumers default with `?? ""`.
- Pure functions take data, return data; I/O confined to `git.ts` (shells git) and `codeIndex.ts` (reads files).
- Predicted coupling is **undirected** and **never** enters `FeatureGraph`/keystone/CPM.
- Already-explicit Linear links (successors **and** relatedMeta) excluded from coupling suggestions.
- Single test: `npx vitest run <path>`; whole suite: `npm test`. Git-backed tests reuse `tests/code/tempRepo.ts` (`makeRepo`).

---

## File Structure

```
src/scope/types.ts        CodeIndex, ScopeMatch, Matcher, TicketScope, ScopeLink, SuggestScopeResult
src/scope/tokenize.ts     tokenize(text): string[]
src/scope/codeIndex.ts    buildCodeIndex(repoPath, files): Promise<CodeIndex>
src/scope/match.ts        KeywordMatcher implements Matcher
src/scope/scopeCouple.ts  scopeCouple(scopes, isLinked, opts): ScopeLink[]; export moduleOf
src/code/git.ts           + listSourceFiles(repoPath): Promise<string[]>
src/linear/types.ts       Issue gains description?: string
src/linear/client.ts      query adds `description`; normalizeProject sets it
src/graph/types.ts        GraphNode gains description?: string
src/graph/build.ts        thread description
src/tools/suggestScope.ts suggestScopeTool(cache, projectId, repoPath)
src/index.ts              register suggest_scope
tests/scope/*.test.ts     tokenize, codeIndex, match, scopeCouple
tests/tools/tools.test.ts suggest_scope handler tests
docs/ROADMAP.md           mark cold-start ✅
```

---

## Task 1: tokenize

**Files:** Create `src/scope/types.ts`, `src/scope/tokenize.ts`, `tests/scope/tokenize.test.ts`

**Interfaces — Produces:** `tokenize(text: string): string[]`; plus the `src/scope/types.ts` types consumed by later tasks.

- [ ] **Step 1: Create `src/scope/types.ts`**

```ts
export interface CodeIndex {
  docs: Map<string, string[]>; // file -> its unique tokens
  df: Map<string, number>; // term -> number of files containing it
  fileCount: number;
}

export interface ScopeMatch {
  file: string;
  score: number;
  matchedTerms: string[]; // shared terms, most distinctive first
}

export interface Matcher {
  score(ticketTokens: string[], index: CodeIndex): ScopeMatch[];
}

export interface TicketScope {
  identifier: string;
  title: string;
  matches: ScopeMatch[];
  modules: string[]; // matched files grouped to dir
}

export interface ScopeLink {
  a: string;
  b: string;
  score: number;
  sharedModules: string[];
  evidence: string[];
}

export interface SuggestScopeResult {
  tickets: TicketScope[];
  links: ScopeLink[];
  warnings: string[];
}
```

- [ ] **Step 2: Write the failing test `tests/scope/tokenize.test.ts`**

```ts
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
    // "add", "to", "the" stopwords; "ts" short; "42" numeric; "src" path-noise
    expect(tokenize("add the 42 to src/foo.ts")).toEqual(["foo"]);
  });
  it("returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, expect FAIL.** `npx vitest run tests/scope/tokenize.test.ts`

- [ ] **Step 4: Create `src/scope/tokenize.ts`**

```ts
const STOPWORDS = new Set([
  // english
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is",
  "are", "be", "this", "that", "it", "as", "at", "by", "from", "into", "via",
  "add", "use", "using", "get", "set", "new", "run", "support", "feature",
  "fix", "improve", "update", "make", "build", "create", "remove",
  // code/path noise
  "src", "lib", "dist", "node", "modules", "test", "tests", "spec", "index",
  "const", "let", "var", "function", "class", "export", "import", "type",
  "interface", "enum", "return", "async", "await", "default", "string",
  "number", "boolean", "void", "null", "undefined",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"); // HTTPServer -> HTTP Server
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}
```

- [ ] **Step 5: Run, expect PASS (4).** `npx vitest run tests/scope/tokenize.test.ts`

- [ ] **Step 6: Commit**
```bash
git add src/scope/types.ts src/scope/tokenize.ts tests/scope/tokenize.test.ts
git commit -m "feat(scope): tokenizer + cold-start types"
```

---

## Task 2: Linear description fetch + threading

**Files:** Modify `src/linear/types.ts`, `src/linear/client.ts`, `src/graph/types.ts`, `src/graph/build.ts`; tests in `tests/linear/normalize.test.ts`, `tests/graph/build.test.ts`

**Interfaces — Produces:** `Issue.description?: string`, `GraphNode.description?: string`, populated by `normalizeProject` and `buildFeatureGraph` (default `""`).

- [ ] **Step 1: Failing tests**

In `tests/linear/normalize.test.ts`, add inside the describe:
```ts
  it("carries the issue description (empty string when absent)", () => {
    const data = normalizeProject({
      issues: { nodes: [
        { id: "x1", identifier: "ENG-9", title: "T", description: "build the econ simulator agent",
          estimate: null, branchName: null, state: { name: "Todo" }, relations: { nodes: [] } },
        { id: "x2", identifier: "ENG-10", title: "U",
          estimate: null, branchName: null, state: { name: "Todo" }, relations: { nodes: [] } },
      ] },
    });
    expect(data.issues[0].description).toBe("build the econ simulator agent");
    expect(data.issues[1].description).toBe("");
  });
```
In `tests/graph/build.test.ts`, add:
```ts
  it("threads description onto the graph node", () => {
    const g = buildFeatureGraph(
      [{ id: "a", identifier: "ENG-1", title: "t", state: "Todo", estimate: null, branchName: null, description: "hello world" }],
      []
    );
    expect(g.nodes.get("a")!.description).toBe("hello world");
  });
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/linear/normalize.test.ts tests/graph/build.test.ts`

- [ ] **Step 3: `src/linear/types.ts`** — in `interface Issue`, after `branchName`, add:
```ts
  description?: string;
```

- [ ] **Step 4: `src/linear/client.ts`** — in `QUERY`, add `description` to the issue node selection (after `title`):
```
        description
```
and in `normalizeProject`'s issue map, add:
```ts
    description: n.description ?? "",
```

- [ ] **Step 5: `src/graph/types.ts`** — in `interface GraphNode`, after `branchName`, add:
```ts
  description?: string;
```

- [ ] **Step 6: `src/graph/build.ts`** — in node construction, add:
```ts
      description: i.description ?? "",
```

- [ ] **Step 7: Run, expect PASS; then full build.**
```bash
npx vitest run tests/linear/normalize.test.ts tests/graph/build.test.ts
npm run build
```

- [ ] **Step 8: Commit**
```bash
git add src/linear/types.ts src/linear/client.ts src/graph/types.ts src/graph/build.ts tests/linear/normalize.test.ts tests/graph/build.test.ts
git commit -m "feat(linear): fetch + thread issue description"
```

---

## Task 3: Source-file listing + code index

**Files:** Modify `src/code/git.ts`; create `src/scope/codeIndex.ts`, `tests/scope/codeIndex.test.ts`

**Interfaces:**
- Consumes: `tokenize` (Task 1), `CodeIndex` (Task 1).
- Produces: `listSourceFiles(repoPath: string): Promise<string[]>` (in git.ts); `buildCodeIndex(repoPath: string, files: string[]): Promise<CodeIndex>`.

- [ ] **Step 1: Failing test `tests/scope/codeIndex.test.ts`**

```ts
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
    // path token "agents", "simulator"; identifier "EconSimulator" -> econ, simulator; comment "harness"
    expect(simDoc).toEqual(expect.arrayContaining(["agents", "simulator", "econ", "harness"]));
    expect(idx.df.get("simulator")).toBe(1);
    expect(idx.df.get("helper")).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/scope/codeIndex.test.ts`

- [ ] **Step 3: Add `listSourceFiles` to `src/code/git.ts`** (append, reusing the existing `exec`):

```ts
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_PATH = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[tj]sx?$/;

export async function listSourceFiles(repoPath: string): Promise<string[]> {
  const { stdout } = await exec("git", ["-C", repoPath, "ls-files"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((f) => f.length > 0 && SOURCE_EXT.test(f) && !TEST_PATH.test(f));
}
```

- [ ] **Step 4: Create `src/scope/codeIndex.ts`**

```ts
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { tokenize } from "./tokenize.js";
import { CodeIndex } from "./types.js";

const ID_RE =
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const MAX_FILE_BYTES = 200_000;

export async function buildCodeIndex(
  repoPath: string,
  files: string[]
): Promise<CodeIndex> {
  const docs = new Map<string, string[]>();
  const df = new Map<string, number>();

  for (const f of files) {
    let content: string;
    try {
      content = await readFile(path.join(repoPath, f), "utf8");
    } catch {
      continue;
    }
    if (content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES);

    const tokens = new Set<string>();
    for (const t of tokenize(f.replace(/\.[^./]+$/, ""))) tokens.add(t); // path
    for (const m of content.matchAll(ID_RE)) for (const t of tokenize(m[1])) tokens.add(t);
    const comments = content.match(COMMENT_RE)?.join(" ") ?? "";
    for (const t of tokenize(comments)) tokens.add(t);

    const arr = [...tokens];
    docs.set(f, arr);
    for (const t of arr) df.set(t, (df.get(t) ?? 0) + 1);
  }

  return { docs, df, fileCount: docs.size };
}
```

- [ ] **Step 5: Run, expect PASS.** `npx vitest run tests/scope/codeIndex.test.ts`

- [ ] **Step 6: Commit**
```bash
git add src/code/git.ts src/scope/codeIndex.ts tests/scope/codeIndex.test.ts
git commit -m "feat(scope): source-file listing + code keyword index"
```

---

## Task 4: KeywordMatcher (TF-IDF)

**Files:** Create `src/scope/match.ts`, `tests/scope/match.test.ts`

**Interfaces:**
- Consumes: `CodeIndex`, `Matcher`, `ScopeMatch` (Task 1).
- Produces: `class KeywordMatcher implements Matcher` (constructor `(topK = 5, minScore = 0.0001)`).

- [ ] **Step 1: Failing test `tests/scope/match.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { KeywordMatcher } from "../../src/scope/match.js";
import { CodeIndex } from "../../src/scope/types.js";

// Hand-built index: 3 files. "common" appears everywhere (idf ~0); distinctive
// terms appear once.
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
    // "common" is in every file (idf ~0); a ticket of only "common" yields ~nothing
    const m = new KeywordMatcher().score(["common"], index);
    expect(m).toEqual([]);
  });

  it("returns at most topK results", () => {
    const m = new KeywordMatcher(1).score(["agents"], index);
    expect(m.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/scope/match.test.ts`

- [ ] **Step 3: Create `src/scope/match.ts`**

```ts
import { CodeIndex, Matcher, ScopeMatch } from "./types.js";

export class KeywordMatcher implements Matcher {
  constructor(
    private topK = 5,
    private minScore = 0.0001
  ) {}

  score(ticketTokens: string[], index: CodeIndex): ScopeMatch[] {
    const idf = (term: string) =>
      Math.log(1 + index.fileCount / (1 + (index.df.get(term) ?? 0)));
    const ticketSet = new Set(ticketTokens);
    const out: ScopeMatch[] = [];

    for (const [file, tokens] of index.docs) {
      const fileSet = new Set(tokens);
      const matched: { term: string; w: number }[] = [];
      let s = 0;
      for (const term of ticketSet) {
        if (fileSet.has(term)) {
          const w = idf(term);
          s += w;
          matched.push({ term, w });
        }
      }
      if (s > this.minScore && matched.length) {
        out.push({
          file,
          score: Math.round(s * 1000) / 1000,
          matchedTerms: matched.sort((a, b) => b.w - a.w).map((mm) => mm.term),
        });
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, this.topK);
  }
}
```

Note: with `fileCount=3`, `df(common)=3` → `idf = ln(1 + 3/4) = ln(1.75) ≈ 0.56`, which is > minScore, so a "common"-only ticket would NOT be empty under naive summation. To satisfy the "ubiquitous term yields nothing" test, raise the floor: a term contributes only when it is at least somewhat distinctive. Change the contribution guard so a term is counted only if `df(term) < fileCount` (a term present in *every* file carries no signal):

```ts
      for (const term of ticketSet) {
        const dft = index.df.get(term) ?? 0;
        if (fileSet.has(term) && dft < index.fileCount) {
          const w = idf(term);
          s += w;
          matched.push({ term, w });
        }
      }
```

Use this guarded version. (A term in *every* file is pure noise; dropping it is both correct and what the test asserts.)

- [ ] **Step 4: Run, expect PASS (3).** `npx vitest run tests/scope/match.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/scope/match.ts tests/scope/match.test.ts
git commit -m "feat(scope): TF-IDF keyword matcher"
```

---

## Task 5: scopeCouple

**Files:** Create `src/scope/scopeCouple.ts`, `tests/scope/scopeCouple.test.ts`

**Interfaces:**
- Consumes: `TicketScope`, `ScopeLink`, `ScopeMatch` (Task 1).
- Produces: `scopeCouple(scopes: TicketScope[], isLinked: (a: string, b: string) => boolean, opts?: { minShared?: number }): ScopeLink[]`; `moduleOf(file: string): string` (exported).

- [ ] **Step 1: Failing test `tests/scope/scopeCouple.test.ts`**

```ts
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
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/scope/scopeCouple.test.ts`

- [ ] **Step 3: Create `src/scope/scopeCouple.ts`**

```ts
import { ScopeLink, TicketScope } from "./types.js";

export function moduleOf(file: string): string {
  const dir = file.split("/").slice(0, -1).join("/");
  return dir || file;
}

export function scopeCouple(
  scopes: TicketScope[],
  isLinked: (a: string, b: string) => boolean,
  opts: { minShared?: number } = {}
): ScopeLink[] {
  const minShared = opts.minShared ?? 1;
  const out: ScopeLink[] = [];

  for (let i = 0; i < scopes.length; i++) {
    for (let j = i + 1; j < scopes.length; j++) {
      const A = scopes[i];
      const B = scopes[j];
      if (isLinked(A.identifier, B.identifier)) continue;

      const aScore = new Map(A.matches.map((m) => [m.file, m.score]));
      const shared = B.matches.filter((m) => aScore.has(m.file));
      if (shared.length < minShared) continue;

      const sharedModules = [...new Set(shared.map((m) => moduleOf(m.file)))];
      const terms = [...new Set(shared.flatMap((m) => m.matchedTerms))].slice(0, 6);
      const raw = shared.reduce(
        (s, m) => s + Math.min(m.score, aScore.get(m.file)!),
        0
      );
      const score = Math.round(Math.min(1, raw / 3) * 100) / 100;

      out.push({
        a: A.identifier,
        b: B.identifier,
        score,
        sharedModules,
        evidence: [`both likely touch ${sharedModules.join(", ")} (terms: ${terms.join(", ")})`],
      });
    }
  }

  return out.sort((x, y) => y.score - x.score);
}
```

- [ ] **Step 4: Run, expect PASS (4).** `npx vitest run tests/scope/scopeCouple.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/scope/scopeCouple.ts tests/scope/scopeCouple.test.ts
git commit -m "feat(scope): predicted ticket coupling from shared scope"
```

---

## Task 6: suggest_scope tool + registration + docs

**Files:** Create `src/tools/suggestScope.ts`; modify `src/index.ts`, `tests/tools/tools.test.ts`, `docs/ROADMAP.md`, `docs/PHASE-IIc-COLD-START.md`

**Interfaces:**
- Consumes: `GraphCache`, `ToolResult`, all `src/scope/*`, `isGitRepo`/`listSourceFiles`.
- Produces: `suggestScopeTool(cache: GraphCache, projectId: string, repoPath: string): Promise<ToolResult>`.

- [ ] **Step 1: Failing tests in `tests/tools/tools.test.ts`**

Add import:
```ts
import { suggestScopeTool } from "../../src/tools/suggestScope.js";
```
Add tests inside the describe (the `sampleProject` issues are ENG-1 "Auth", ENG-2 "Session", ENG-3 "Login"):
```ts
  it("suggest_scope predicts code areas from ticket text", async () => {
    const { makeRepo } = await import("../code/tempRepo.js");
    const repo = makeRepo([{ message: "init", files: {
      "src/auth/session.ts": "// session auth\nexport class SessionStore {}",
      "src/unrelated/math.ts": "export const add = (a, b) => a + b;",
    } }]);
    const r = await suggestScopeTool(newCache(), "p1", repo);
    // ENG-2 "Session" should predict the session file
    expect(r.text).toMatch(/ENG-2/);
    expect(r.text).toMatch(/session/i);
  });

  it("suggest_scope errors clearly when repo_path is not a git repo", async () => {
    const { tmpdir } = await import("node:os");
    const r = await suggestScopeTool(newCache(), "p1", tmpdir());
    expect(r.text).toMatch(/not a git repo/i);
  });
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/tools/tools.test.ts`

- [ ] **Step 3: Create `src/tools/suggestScope.ts`**

```ts
import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { isGitRepo, listSourceFiles } from "../code/git.js";
import { buildCodeIndex } from "../scope/codeIndex.js";
import { tokenize } from "../scope/tokenize.js";
import { KeywordMatcher } from "../scope/match.js";
import { scopeCouple, moduleOf } from "../scope/scopeCouple.js";
import { SuggestScopeResult, TicketScope } from "../scope/types.js";

export async function suggestScopeTool(
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
  const sourceFiles = await listSourceFiles(repoPath);
  if (!sourceFiles.length) {
    return {
      text: "No source files found in the repo to match ticket text against.",
      structured: { tickets: [], links: [], warnings: ["no source files"] },
    };
  }

  const index = await buildCodeIndex(repoPath, sourceFiles);
  const matcher = new KeywordMatcher();

  const tickets: TicketScope[] = [...graph.nodes.values()].map((n) => {
    const matches = matcher.score(tokenize(`${n.title} ${n.description ?? ""}`), index);
    return {
      identifier: n.identifier,
      title: n.title,
      matches,
      modules: [...new Set(matches.map((m) => moduleOf(m.file)))],
    };
  });

  const idByIdentifier = new Map(
    [...graph.nodes.values()].map((n) => [n.identifier, n.id])
  );
  const isLinked = (aI: string, bI: string): boolean => {
    const a = idByIdentifier.get(aI);
    const b = idByIdentifier.get(bI);
    if (!a || !b) return false;
    return (
      (graph.successors.get(a)?.has(b) ?? false) ||
      (graph.successors.get(b)?.has(a) ?? false) ||
      (graph.relatedMeta.get(a)?.has(b) ?? false) ||
      (graph.relatedMeta.get(b)?.has(a) ?? false)
    );
  };

  const links = scopeCouple(tickets, isLinked);
  const result: SuggestScopeResult = { tickets, links, warnings: [] };
  return { text: render(result), structured: result };
}

function render(r: SuggestScopeResult): string {
  const withMatch = r.tickets.filter((t) => t.matches.length);
  const noMatch = r.tickets.filter((t) => !t.matches.length).map((t) => t.identifier);

  let text =
    "Predicted scope (planning aid — confirm before acting; not asserted, not used in keystone/critical_path).";

  if (withMatch.length) {
    text +=
      "\n\nLikely code areas per ticket:\n" +
      withMatch
        .map(
          (t) =>
            `- ${t.identifier} "${t.title}" → ${t.modules.join(", ")} (matched: ${[
              ...new Set(t.matches.flatMap((m) => m.matchedTerms)),
            ]
              .slice(0, 6)
              .join(", ")})`
        )
        .join("\n");
  }

  if (r.links.length) {
    text +=
      "\n\nLikely couplings (consider linking in Linear):\n" +
      r.links
        .slice(0, 15)
        .map((l) => `- ${l.identifier_a ?? l.a} ↔ ${l.b} (score ${l.score}) — ${l.evidence.join("; ")}`)
        .join("\n");
  }

  if (noMatch.length) {
    text += `\n\nNo confident match for: ${noMatch.join(", ")} (likely new code, or thin ticket text).`;
  }
  return text;
}
```

Note: in `render`, the coupling line must use `l.a` and `l.b` (there is no `identifier_a` field). Write it as:
```ts
        .map((l) => `- ${l.a} ↔ ${l.b} (score ${l.score}) — ${l.evidence.join("; ")}`)
```

- [ ] **Step 4: Register in `src/index.ts`**

Add import:
```ts
import { suggestScopeTool } from "./tools/suggestScope.js";
```
Add registration after the `suggest_links` registration:
```ts
  server.registerTool(
    "suggest_scope",
    {
      title: "Predict a ticket's code scope (cold-start)",
      description:
        "For tickets with no code yet, predict which code areas each will likely touch and which tickets likely couple — by matching ticket text against a keyword index of the repo. Planning aid: suggestions only, never asserted, never used in keystone/critical_path. project_id accepts a name, slug, or UUID; repo_path is the absolute path to the project's local git checkout.",
      inputSchema: {
        project_id: projectId,
        repo_path: z.string().describe("Absolute path to the project's local git checkout"),
      },
    },
    async ({ project_id, repo_path }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await suggestScopeTool(cache, id, repo_path));
    }
  );
```

- [ ] **Step 5: Run tests + full suite + build**
```bash
npx vitest run tests/tools/tools.test.ts
npm run build && npm test
```
Expected: build type-clean; whole suite green; server registers 7 tools.

- [ ] **Step 6: Docs**
- `README.md` tools table — add a row:
  `| \`suggest_scope\` | \`project_id\`, \`repo_path\` | **Cold-start**: predicts which code areas a ticket will likely touch and which tickets likely couple, from ticket text vs a keyword index of the repo — for backlog tickets with no code yet. Planning aid; never used in keystone/critical_path. |`
- `docs/ROADMAP.md` — flip the "Cold-start semantic matching" line to ✅ with a note (keyword/TF-IDF, `suggest_scope` tool).
- `docs/PHASE-IIc-COLD-START.md` — change status to "implemented".
- `docs/ARCHITECTURE.md` — "six tools" → "seven tools"; add `suggest_scope`; note `src/scope/` as a read-only keyword-matching layer (no embeddings; deterministic), inferred scope never enters `FeatureGraph`.

- [ ] **Step 7: Commit**
```bash
git add src/tools/suggestScope.ts src/index.ts tests/tools/tools.test.ts README.md docs/ROADMAP.md docs/PHASE-IIc-COLD-START.md docs/ARCHITECTURE.md
git commit -m "feat: suggest_scope tool — cold-start code-area prediction"
```

---

## Self-Review Notes

**Spec coverage** (against `PHASE-IIc-COLD-START.md`):
- Keyword/TF-IDF matcher behind a `Matcher` seam; no embeddings → Tasks 1, 4. ✓
- File-level index (path + identifiers + comments), source files via `git ls-files` → Task 3. ✓
- Ticket title + description (new Linear fetch) → Task 2. ✓
- Standalone `suggest_scope` tool; suggestions only; never in keystone/CPM → Task 6 (operates outside `FeatureGraph`; only reads it for text + dedup). ✓
- Undirected predicted coupling; already-linked (successors + relatedMeta) excluded → Tasks 5, 6. ✓
- Edge cases: not-a-git-repo, no source files, thin-text/no-match, large-file cap → Tasks 6, 3. ✓
- Testing: tokenize, codeIndex (temp repo), matcher (hand index), scopeCouple, end-to-end tool. ✓

**Type consistency:** `CodeIndex`/`ScopeMatch`/`Matcher`/`TicketScope`/`ScopeLink`/`SuggestScopeResult` defined in Task 1 and used unchanged downstream. `description?: string` identical on `Issue` and `GraphNode`, defaulted `""`. `moduleOf` exported from `scopeCouple` and reused by the tool. The `render` coupling line uses `l.a`/`l.b` (corrected note in Task 6).

**Placeholder scan:** none — every step carries complete code and an expected result. (The two inline "Note:" corrections in Tasks 4 and 6 are deliberate: they tell the implementer the exact final code to use.)

**Deferred (per spec):** embeddings, symbol-level granularity, stemming, folding scope into suggest_links/keystone/CPM.
```
