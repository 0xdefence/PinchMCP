# Phase III Finish — Consolidated Plan (decompose_grounding + polish)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the generative arc with a `decompose_grounding` tool, plus close the high-value polish items (stale-blocker gaps, explain_blockers cycle note, importGraph comment-strip), and document the decomposition workflow.

**Architecture:** `decompose_grounding` reuses the `src/scope/` cold-start layer — it runs the keyword matcher on a free-text *feature description* (instead of existing ticket text) to predict code areas, and cross-references existing tickets whose predicted scope overlaps. pinch still only produces grounding; the client decomposes and the Linear MCP writes. The polish items are localized changes to `gaps.ts`/`blockers.ts`/`importGraph.ts`.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` suffixes), vitest. No new dependencies.

## Global Constraints

- TS ESM NodeNext; relative imports use `.js`. Build type-clean (`noEmitOnError`, `types:["node"]`).
- New fields are optional (`?`) so existing literals compile; production code defaults them.
- Nothing here enters `FeatureGraph` or affects keystone/CPM. `decompose_grounding` is a planning aid (suggestions, confirm-before-acting); pinch never writes to Linear.
- Single test: `npx vitest run <path>`; whole suite: `npm test`. Git-backed tests reuse `tests/code/tempRepo.ts`.

## Scope boundary

In scope: the five items above. **Deferred** (separate future efforts, each needs its own spec): whole-org/cross-project scope, MCP-to-MCP passthrough, embedding `Matcher` backend.

---

## Task 1: Linear `state.type` fetch + thread

**Files:** `src/linear/types.ts`, `src/linear/client.ts`, `src/graph/types.ts`, `src/graph/build.ts`; tests `tests/linear/normalize.test.ts`, `tests/graph/build.test.ts`.

**Interfaces — Produces:** `Issue.stateType?: string`, `GraphNode.stateType?: string` (Linear workflow-state type: `backlog|unstarted|started|completed|canceled|triage`), default `""`.

- [ ] **Step 1: Failing tests**

In `tests/linear/normalize.test.ts`:
```ts
  it("carries the workflow state type", () => {
    const data = normalizeProject({
      issues: { nodes: [
        { id: "x1", identifier: "ENG-9", title: "T", estimate: null, branchName: null,
          state: { name: "Done", type: "completed" }, relations: { nodes: [] } },
        { id: "x2", identifier: "ENG-10", title: "U", estimate: null, branchName: null,
          state: { name: "Todo" }, relations: { nodes: [] } },
      ] },
    });
    expect(data.issues[0].stateType).toBe("completed");
    expect(data.issues[1].stateType).toBe("");
  });
```
In `tests/graph/build.test.ts`:
```ts
  it("threads stateType onto the graph node", () => {
    const g = buildFeatureGraph(
      [{ id: "a", identifier: "ENG-1", title: "t", state: "Done", estimate: null, branchName: null, stateType: "completed" }],
      []
    );
    expect(g.nodes.get("a")!.stateType).toBe("completed");
  });
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/linear/normalize.test.ts tests/graph/build.test.ts`

- [ ] **Step 3:** `src/linear/types.ts` — in `interface Issue`, after `state`, add `stateType?: string;`
- [ ] **Step 4:** `src/linear/client.ts` — change `state { name }` in `QUERY` to `state { name type }`; in `normalizeProject`'s map add `stateType: n.state?.type ?? "",`
- [ ] **Step 5:** `src/graph/types.ts` — in `interface GraphNode`, after `state`, add `stateType?: string;`
- [ ] **Step 6:** `src/graph/build.ts` — in node construction add `stateType: i.stateType ?? "",`

- [ ] **Step 7: Run tests + build.** `npx vitest run tests/linear/normalize.test.ts tests/graph/build.test.ts && npm run build`
- [ ] **Step 8: Commit** — `git commit -am "feat(linear): fetch + thread workflow state type"`

---

## Task 2: stale-blocker gap

**Files:** `src/graph/gaps.ts`, `src/tools/surfaceGaps.ts`; tests `tests/graph/gaps.test.ts`.

**Interfaces — Produces:** `GapReport.staleBlockers: string[]` (descriptions like `"ENG-2 (blocked by ENG-1, which is completed)"`).

- [ ] **Step 1: Failing test in `tests/graph/gaps.test.ts`**

```ts
  it("flags a ticket blocked by a completed/canceled ticket", () => {
    // a (completed) blocks b -> b has a stale blocker
    const g = buildFeatureGraph(
      [issue("a", { stateType: "completed" }), issue("b")],
      [blocks("a", "b")]
    );
    const sb = findGaps(g).staleBlockers;
    expect(sb).toHaveLength(1);
    expect(sb[0]).toMatch(/B.*A.*completed/);
  });

  it("does not flag a blocker that is still open", () => {
    const g = buildFeatureGraph(
      [issue("a", { stateType: "started" }), issue("b")],
      [blocks("a", "b")]
    );
    expect(findGaps(g).staleBlockers).toEqual([]);
  });
```
(The `issue` helper in this file already spreads `extra`; `stateType` flows through since it's an `Issue` field.)

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/graph/gaps.test.ts`

- [ ] **Step 3: Edit `src/graph/gaps.ts`** — add `staleBlockers` to `GapReport` and compute it. After the `unownedKeystones` block, add:
```ts
  const DONE = new Set(["completed", "canceled"]);
  const staleBlockers: string[] = [];
  for (const id of nodeIds) {
    for (const blocker of graph.predecessors.get(id) ?? []) {
      const b = graph.nodes.get(blocker)!;
      if (b.stateType && DONE.has(b.stateType)) {
        staleBlockers.push(`${ident(id)} (blocked by ${b.identifier}, which is ${b.stateType})`);
      }
    }
  }
```
Add `staleBlockers` to the `GapReport` interface (`staleBlockers: string[];`), to the returned object, and into `summary` (e.g. append `, ${staleBlockers.length} stale blocker(s).`).

- [ ] **Step 4: Edit `src/tools/surfaceGaps.ts` render** — add a section (place it first, it's the most actionable):
```ts
  if (r.staleBlockers.length) {
    sections.push(`Stale blockers (blocker already done — ticket may be ready): ${r.staleBlockers.join("; ")}`);
  }
```

- [ ] **Step 5: Run tests + build + suite.** `npx vitest run tests/graph/gaps.test.ts && npm run build && npm test`
- [ ] **Step 6: Commit** — `git commit -am "feat(graph): surface_gaps flags stale blockers (blocker already done)"`

---

## Task 3: explain_blockers cycle annotation

**Files:** `src/graph/blockers.ts`; test `tests/graph/blockers.test.ts`.

**Interfaces — Produces:** `BlockerExplanation.inCycle: boolean`; the summary notes a cycle.

- [ ] **Step 1: Failing test in `tests/graph/blockers.test.ts`**
```ts
  it("annotates when the ticket participates in a cycle", () => {
    const g = buildFeatureGraph(["a", "b"].map(issue), [blocks("a", "b"), blocks("b", "a")]);
    const e = explainBlockers(g, "a");
    expect(e.inCycle).toBe(true);
    expect(e.summary.toLowerCase()).toMatch(/cycle/);
  });

  it("inCycle is false for an acyclic ticket", () => {
    const g = buildFeatureGraph(["a", "b"].map(issue), [blocks("a", "b")]);
    expect(explainBlockers(g, "a").inCycle).toBe(false);
  });
```
(Use that file's existing `issue`/`blocks` helpers.)

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/graph/blockers.test.ts`

- [ ] **Step 3: Edit `src/graph/blockers.ts`**
- Add `import { detectCycle } from "./keystone.js";`
- Add `inCycle: boolean;` to `interface BlockerExplanation`.
- In `explainBlockers`, after resolving `node`, compute `const inCycle = detectCycle(graph, [...graph.nodes.keys()]).includes(node.id);`
- Add `inCycle` to BOTH returned objects (found and not-found; not-found → `false`).
- When `inCycle`, append to the summary: ` ⚠ Participates in a dependency cycle — resolve it before scheduling.`

- [ ] **Step 4: Run tests + build.** `npx vitest run tests/graph/blockers.test.ts && npm run build`
- [ ] **Step 5: Commit** — `git commit -am "feat(graph): annotate explain_blockers when the ticket is in a cycle"`

---

## Task 4: importGraph comment-strip

**Files:** `src/code/importGraph.ts`; test `tests/code/importGraph.test.ts`.

**Interfaces:** behavior change only — commented-out imports no longer produce edges.

- [ ] **Step 1: Failing test in `tests/code/importGraph.test.ts`**
```ts
  it("ignores imports inside comments", async () => {
    const repo = makeRepo([{ message: "init", files: {
      "src/a.ts": `// import { x } from "./b";\n/* import "./c"; */\nexport const ok = 1;`,
      "src/b.ts": `export const b = 1;`,
      "src/c.ts": `export const c = 1;`,
    } }]);
    const g = await buildImportGraph(repo, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect([...(g.get("src/a.ts") ?? [])]).toEqual([]);
  });
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/code/importGraph.test.ts`

- [ ] **Step 3: Edit `src/code/importGraph.ts`** — add a comment regex and strip before matching specifiers:
```ts
const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
```
In `buildImportGraph`, after reading `content`, change the matching to run on a comment-stripped copy:
```ts
    const code = content.replace(COMMENT_RE, "");
    for (const m of code.matchAll(SPEC_RE)) {
```
(Use `code` in the `matchAll`, not `content`.)

- [ ] **Step 4: Run tests + build + suite.** `npx vitest run tests/code/importGraph.test.ts && npm run build && npm test`
- [ ] **Step 5: Commit** — `git commit -am "fix(code): importGraph ignores commented-out imports"`

---

## Task 5: groundFeature + decompose_grounding tool

**Files:** Create `src/scope/groundFeature.ts`, `src/tools/decomposeGrounding.ts`; modify `src/index.ts`; tests `tests/scope/groundFeature.test.ts`, `tests/tools/tools.test.ts`.

**Interfaces:**
- Consumes: `tokenize`, `KeywordMatcher`/`Matcher`, `CodeIndex`, `TicketScope`, `ScopeMatch`, `moduleOf`.
- Produces: `groundFeature(featureText, index, ticketScopes, matcher): FeatureGrounding`; `decomposeGroundingTool(cache, projectId, repoPath, feature): Promise<ToolResult>`.

- [ ] **Step 1: Failing test `tests/scope/groundFeature.test.ts`**
```ts
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
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/scope/groundFeature.test.ts`

- [ ] **Step 3: Create `src/scope/groundFeature.ts`**
```ts
import { CodeIndex, Matcher, ScopeMatch, TicketScope } from "./types.js";
import { tokenize } from "./tokenize.js";
import { moduleOf } from "./scopeCouple.js";

export interface RelatedTicket {
  identifier: string;
  sharedModules: string[];
  terms: string[];
}

export interface FeatureGrounding {
  predictedModules: string[];
  matchedFiles: ScopeMatch[];
  relatedTickets: RelatedTicket[];
}

export function groundFeature(
  featureText: string,
  index: CodeIndex,
  ticketScopes: TicketScope[],
  matcher: Matcher
): FeatureGrounding {
  const matchedFiles = matcher.score(tokenize(featureText), index);
  const predictedModules = [...new Set(matchedFiles.map((m) => moduleOf(m.file)))];
  const featureFiles = new Set(matchedFiles.map((m) => m.file));

  const relatedTickets: RelatedTicket[] = ticketScopes
    .map((ts) => {
      const shared = ts.matches.filter((m) => featureFiles.has(m.file));
      if (!shared.length) return null;
      return {
        identifier: ts.identifier,
        sharedModules: [...new Set(shared.map((m) => moduleOf(m.file)))],
        terms: [...new Set(shared.flatMap((m) => m.matchedTerms))].slice(0, 6),
      };
    })
    .filter((x): x is RelatedTicket => x !== null);

  return { predictedModules, matchedFiles, relatedTickets };
}
```

- [ ] **Step 4: Failing tool tests in `tests/tools/tools.test.ts`**
Add import: `import { decomposeGroundingTool } from "../../src/tools/decomposeGrounding.js";`
```ts
  it("decompose_grounding predicts modules for a feature and links related tickets", async () => {
    const { makeRepo } = await import("../code/tempRepo.js");
    const repo = makeRepo([{ message: "init", files: {
      "src/auth/session.ts": "// session auth\nexport class SessionStore {}",
    } }]);
    // sampleProject has ENG-2 "Session" — it predicts the session file too.
    const r = await decomposeGroundingTool(newCache(), "p1", repo, "add a new session login screen");
    expect(r.text.toLowerCase()).toMatch(/session|auth/);
  });

  it("decompose_grounding errors clearly when repo_path is not a git repo", async () => {
    const { tmpdir } = await import("node:os");
    const r = await decomposeGroundingTool(newCache(), "p1", tmpdir(), "anything");
    expect(r.text).toMatch(/not a git repo/i);
  });
```

- [ ] **Step 5: Create `src/tools/decomposeGrounding.ts`**
```ts
import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { isGitRepo, listSourceFiles } from "../code/git.js";
import { buildCodeIndex } from "../scope/codeIndex.js";
import { tokenize } from "../scope/tokenize.js";
import { KeywordMatcher } from "../scope/match.js";
import { moduleOf } from "../scope/scopeCouple.js";
import { groundFeature, FeatureGrounding } from "../scope/groundFeature.js";
import { TicketScope } from "../scope/types.js";

export async function decomposeGroundingTool(
  cache: GraphCache,
  projectId: string,
  repoPath: string,
  feature: string
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
    return { text: "No source files in the repo to ground against.", structured: { error: "no_source_files" } };
  }

  const index = await buildCodeIndex(repoPath, sourceFiles);
  const matcher = new KeywordMatcher();
  const ticketScopes: TicketScope[] = [...graph.nodes.values()].map((n) => {
    const matches = matcher.score(tokenize(`${n.title} ${n.description ?? ""}`), index);
    return { identifier: n.identifier, title: n.title, matches, modules: [...new Set(matches.map((m) => moduleOf(m.file)))] };
  });

  const grounding = groundFeature(feature, index, ticketScopes, matcher);
  return { text: render(feature, grounding), structured: grounding };
}

function render(feature: string, g: FeatureGrounding): string {
  let text =
    `Grounding for "${feature}" (planning aid — use this to decompose into tickets; pinch does not create them).`;
  if (g.predictedModules.length) {
    text += `\n\nLikely code areas: ${g.predictedModules.join(", ")}`;
  } else {
    text += `\n\nNo strong code-area match (new area, or thin description).`;
  }
  if (g.relatedTickets.length) {
    text +=
      `\n\nRelated existing tickets (avoid duplication; consider linking):\n` +
      g.relatedTickets
        .map((t) => `- ${t.identifier} — shares ${t.sharedModules.join(", ")} (terms: ${t.terms.join(", ")})`)
        .join("\n");
  }
  text += `\n\nNext: propose tickets grounded on the areas above, then create them via the Linear MCP.`;
  return text;
}
```

- [ ] **Step 6: Register in `src/index.ts`** — add import and, after the `surface_gaps` registration:
```ts
  server.registerTool(
    "decompose_grounding",
    {
      title: "Ground a feature for decomposition (cold-start)",
      description:
        "Given a free-text feature description, predict which code areas it will touch and which existing tickets overlap — grounding for the client to decompose it into tickets. Suggestions only; pinch never creates tickets (use the Linear MCP). project_id accepts a name/slug/UUID; repo_path is the local checkout; feature is the description to ground.",
      inputSchema: {
        project_id: projectId,
        repo_path: z.string().describe("Absolute path to the project's local git checkout"),
        feature: z.string().describe("Free-text description of the feature to ground"),
      },
    },
    async ({ project_id, repo_path, feature }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await decomposeGroundingTool(cache, id, repo_path, feature));
    }
  );
```

- [ ] **Step 7: Run tests + build + suite.** `npx vitest run tests/scope/groundFeature.test.ts tests/tools/tools.test.ts && npm run build && npm test` — expect green; 9 `registerTool(` calls.
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: decompose_grounding tool — ground a feature for client decomposition"`

---

## Task 6: Docs — workflow guide + refresh

**Files:** Create `docs/DECOMPOSITION-WORKFLOW.md`; modify `README.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`.

- [ ] **Step 1: Create `docs/DECOMPOSITION-WORKFLOW.md`** — a short guide:
  - The division: pinch grounds (`decompose_grounding`), Claude Code generates the proposed tickets, the Linear MCP creates them.
  - Worked example: *"call `decompose_grounding(project, repo, "feature")` → read predicted areas + related tickets → ask Claude Code to draft tickets with suggested blocking links → create via Linear MCP → re-run `rank_keystones`/`surface_gaps` to verify."*
  - The guarantee: pinch never writes to Linear.

- [ ] **Step 2: `README.md`** — add two rows to the tools table:
```
| `surface_gaps` | `project_id` | Graph hygiene: cycles, isolated tickets, stale blockers (blocker already done), and keystones missing an estimate or owner. |
| `decompose_grounding` | `project_id`, `repo_path`, `feature` | Cold-start grounding for a free-text feature: predicted code areas + related existing tickets, for the client to decompose. Never creates tickets. |
```
(If a `surface_gaps` row already exists, update it to mention stale blockers rather than adding a duplicate.) Link `docs/DECOMPOSITION-WORKFLOW.md` from the Documentation section.

- [ ] **Step 3: `docs/ROADMAP.md`** — mark "Grounded suggestions" / decomposition-grounding ✅ (decompose_grounding shipped); note the decomposition workflow is documented. Update `surface_gaps` line to include stale blockers. Update the closing status line.

- [ ] **Step 4: `docs/ARCHITECTURE.md`** — "eight tools" → "nine tools"; add `decompose_grounding` to the tool list and `groundFeature.ts` to the `src/scope/` table; add `gaps.ts` stale-blocker note if helpful.

- [ ] **Step 5: Build + full suite.** `npm run build && npm test` — green.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "docs: decomposition workflow guide + finish-phase doc refresh"`

---

## Self-Review Notes

**Spec coverage:** decompose_grounding (Task 5) reuses scope/ on feature text + cross-references ticket scopes — completes the generative arc with pinch staying analysis-only. Stale blockers (Tasks 1–2), cycle annotation (Task 3), comment-strip (Task 4), docs (Task 6). ✓

**Type consistency:** `stateType?: string` identical on `Issue`/`GraphNode` (default `""`). `GapReport` gains `staleBlockers: string[]`. `BlockerExplanation` gains `inCycle: boolean`. `FeatureGrounding`/`RelatedTicket` defined in `groundFeature.ts`, consumed by the tool. `moduleOf` reused from `scopeCouple`. `detectCycle` already exported from `keystone.ts`.

**Placeholder scan:** none — every step has concrete code/edits and an expected result.

**Deferred (explicit):** whole-org scope, MCP-to-MCP passthrough, embedding Matcher backend — each its own future spec.
