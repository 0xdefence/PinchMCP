# Phase III — surface_gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic `surface_gaps(project_id)` tool that reports graph hygiene gaps — cycles, isolated tickets, and high-leverage tickets missing an estimate or owner — composed from existing analysis. No LLM, no writes.

**Architecture:** `findGaps(graph)` (pure) composes `rankKeystones` (leverage + isolated) and the existing `detectCycle`, plus node fields. A small Linear addition fetches `assignee`. A thin tool renders the report.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` suffixes), vitest. No new dependencies.

## Global Constraints

- TS ESM NodeNext; relative imports use `.js`. Build type-clean (`noEmitOnError`, `types:["node"]`).
- New `assignee?: string | null` field is optional so existing literals compile; production code defaults it to `null`.
- `findGaps` is a pure function over `FeatureGraph`; it never mutates the graph.
- A "keystone" here = a ticket with `leverage > 0` (gatekeeps ≥1 ticket), from `rankKeystones`.
- Single test: `npx vitest run <path>`; whole suite: `npm test`.

---

## Task 1: Linear `assignee` fetch + thread

**Files:** Modify `src/linear/types.ts`, `src/linear/client.ts`, `src/graph/types.ts`, `src/graph/build.ts`; tests `tests/linear/normalize.test.ts`, `tests/graph/build.test.ts`.

**Interfaces — Produces:** `Issue.assignee?: string | null`, `GraphNode.assignee?: string | null`, populated by `normalizeProject`/`buildFeatureGraph` (default `null`).

- [ ] **Step 1: Failing tests**

In `tests/linear/normalize.test.ts`, add:
```ts
  it("carries the assignee name (null when unassigned)", () => {
    const data = normalizeProject({
      issues: { nodes: [
        { id: "x1", identifier: "ENG-9", title: "T", estimate: null, branchName: null,
          state: { name: "Todo" }, relations: { nodes: [] }, assignee: { name: "Ada" } },
        { id: "x2", identifier: "ENG-10", title: "U", estimate: null, branchName: null,
          state: { name: "Todo" }, relations: { nodes: [] } },
      ] },
    });
    expect(data.issues[0].assignee).toBe("Ada");
    expect(data.issues[1].assignee).toBeNull();
  });
```
In `tests/graph/build.test.ts`, add:
```ts
  it("threads assignee onto the graph node", () => {
    const g = buildFeatureGraph(
      [{ id: "a", identifier: "ENG-1", title: "t", state: "Todo", estimate: null, branchName: null, assignee: "Ada" }],
      []
    );
    expect(g.nodes.get("a")!.assignee).toBe("Ada");
  });
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/linear/normalize.test.ts tests/graph/build.test.ts`

- [ ] **Step 3: `src/linear/types.ts`** — in `interface Issue`, after `branchName`, add:
```ts
  assignee?: string | null;
```

- [ ] **Step 4: `src/linear/client.ts`** — in `QUERY`, add to the issue node selection (after `state { name }`):
```
        assignee { name }
```
and in `normalizeProject`'s issue map, add:
```ts
    assignee: n.assignee?.name ?? null,
```

- [ ] **Step 5: `src/graph/types.ts`** — in `interface GraphNode`, after `branchName`, add:
```ts
  assignee?: string | null;
```

- [ ] **Step 6: `src/graph/build.ts`** — in node construction, add:
```ts
      assignee: i.assignee ?? null,
```

- [ ] **Step 7: Run tests + build.** `npx vitest run tests/linear/normalize.test.ts tests/graph/build.test.ts` then `npm run build`.

- [ ] **Step 8: Commit**
```bash
git add src/linear/types.ts src/linear/client.ts src/graph/types.ts src/graph/build.ts tests/linear/normalize.test.ts tests/graph/build.test.ts
git commit -m "feat(linear): fetch + thread issue assignee"
```

---

## Task 2: findGaps

**Files:** Modify `src/graph/keystone.ts` (export `detectCycle`); create `src/graph/gaps.ts`, `tests/graph/gaps.test.ts`.

**Interfaces:**
- Consumes: `rankKeystones`, `detectCycle` (keystone.ts), `FeatureGraph`, `GraphNode.estimate`/`.assignee`.
- Produces: `findGaps(graph: FeatureGraph): GapReport` with `interface GapReport { cycles: string[]; isolated: string[]; unestimatedKeystones: string[]; unownedKeystones: string[]; summary: string }`.

- [ ] **Step 1: Export `detectCycle` from `src/graph/keystone.ts`**

Find the line `function detectCycle(` and add the `export` keyword: `export function detectCycle(`. (Signature is `(graph: FeatureGraph, nodeIds: string[]): string[]`, returning the ids of nodes in a cycle. Do not change its body.)

- [ ] **Step 2: Write the failing test `tests/graph/gaps.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { findGaps } from "../../src/graph/gaps.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (
  id: string,
  extra: Partial<Issue> = {}
): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: `T ${id}`,
  state: "Todo",
  estimate: null,
  branchName: null,
  assignee: null,
  ...extra,
});
const blocks = (from: string, to: string): Relation => ({ type: "blocks", fromIssueId: from, toIssueId: to });

describe("findGaps", () => {
  it("flags cycle members", () => {
    const g = buildFeatureGraph([issue("a"), issue("b")], [blocks("a", "b"), blocks("b", "a")]);
    expect(findGaps(g).cycles.sort()).toEqual(["A", "B"]);
  });

  it("flags isolated tickets", () => {
    const g = buildFeatureGraph([issue("a"), issue("b")], []);
    expect(findGaps(g).isolated.sort()).toEqual(["A", "B"]);
  });

  it("flags a keystone missing an estimate", () => {
    // a -> b: a has leverage 1, no estimate
    const g = buildFeatureGraph([issue("a"), issue("b")], [blocks("a", "b")]);
    expect(findGaps(g).unestimatedKeystones).toEqual(["A"]);
  });

  it("flags a keystone missing an owner", () => {
    const g = buildFeatureGraph([issue("a"), issue("b")], [blocks("a", "b")]);
    expect(findGaps(g).unownedKeystones).toEqual(["A"]);
  });

  it("reports no gaps for a clean, estimated, owned graph", () => {
    const g = buildFeatureGraph(
      [issue("a", { estimate: 3, assignee: "Ada" }), issue("b", { estimate: 1, assignee: "Bo" })],
      [blocks("a", "b")]
    );
    const r = findGaps(g);
    expect(r.cycles).toEqual([]);
    expect(r.isolated).toEqual([]);
    expect(r.unestimatedKeystones).toEqual([]);
    expect(r.unownedKeystones).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, expect FAIL.** `npx vitest run tests/graph/gaps.test.ts`

- [ ] **Step 4: Create `src/graph/gaps.ts`**

```ts
import { FeatureGraph } from "./types.js";
import { rankKeystones, detectCycle } from "./keystone.js";

export interface GapReport {
  cycles: string[];
  isolated: string[];
  unestimatedKeystones: string[];
  unownedKeystones: string[];
  summary: string;
}

export function findGaps(graph: FeatureGraph): GapReport {
  const nodeIds = [...graph.nodes.keys()];
  const ident = (id: string) => graph.nodes.get(id)!.identifier;

  const ranking = rankKeystones(graph);
  const cycles = detectCycle(graph, nodeIds).map(ident);
  const isolated = ranking.isolated.map(ident);

  const keystones = ranking.ranked.filter((e) => e.leverage > 0);
  const unestimatedKeystones = keystones
    .filter((e) => graph.nodes.get(e.id)!.estimate == null)
    .map((e) => e.identifier);
  const unownedKeystones = keystones
    .filter((e) => !graph.nodes.get(e.id)!.assignee)
    .map((e) => e.identifier);

  const summary =
    `${cycles.length} cycle member(s), ${isolated.length} isolated, ` +
    `${unestimatedKeystones.length} unestimated keystone(s), ` +
    `${unownedKeystones.length} unowned keystone(s).`;

  return { cycles, isolated, unestimatedKeystones, unownedKeystones, summary };
}
```

- [ ] **Step 5: Run, expect PASS (5).** `npx vitest run tests/graph/gaps.test.ts`

- [ ] **Step 6: Commit**
```bash
git add src/graph/keystone.ts src/graph/gaps.ts tests/graph/gaps.test.ts
git commit -m "feat(graph): findGaps — cycles, isolated, unestimated/unowned keystones"
```

---

## Task 3: surface_gaps tool + registration + docs

**Files:** Create `src/tools/surfaceGaps.ts`; modify `src/index.ts`, `tests/tools/tools.test.ts`, `README.md`, `docs/ROADMAP.md`, `docs/PHASE-III-SURFACE-GAPS.md`, `docs/ARCHITECTURE.md`.

**Interfaces:**
- Consumes: `GraphCache`, `ToolResult`, `findGaps`/`GapReport`.
- Produces: `surfaceGapsTool(cache: GraphCache, projectId: string): Promise<ToolResult>`.

- [ ] **Step 1: Failing test in `tests/tools/tools.test.ts`**

Add import:
```ts
import { surfaceGapsTool } from "../../src/tools/surfaceGaps.js";
```
Add test (sampleProject: ENG-1 blocks ENG-2 and ENG-3, no estimates, no assignees → ENG-1 is a keystone that is both unestimated and unowned):
```ts
  it("surface_gaps flags an unestimated, unowned keystone", async () => {
    const r = await surfaceGapsTool(newCache(), "p1");
    expect(r.text).toMatch(/ENG-1/);
    expect(r.text.toLowerCase()).toMatch(/unestimated/);
    expect(r.text.toLowerCase()).toMatch(/unowned/);
  });
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/tools/tools.test.ts`

- [ ] **Step 3: Create `src/tools/surfaceGaps.ts`**

```ts
import { GraphCache } from "../cache.js";
import { ToolResult } from "./buildFeatureGraph.js";
import { findGaps, GapReport } from "../graph/gaps.js";

export async function surfaceGapsTool(
  cache: GraphCache,
  projectId: string
): Promise<ToolResult> {
  const graph = await cache.getOrBuild(projectId);
  if (graph.nodes.size === 0) {
    return { text: "No issues in project.", structured: { issues: 0 } };
  }
  const report = findGaps(graph);
  return { text: render(report), structured: report };
}

function render(r: GapReport): string {
  const sections: string[] = [];
  if (r.cycles.length) {
    sections.push(`Cycles (must break to schedule): ${r.cycles.join(", ")}`);
  }
  if (r.unestimatedKeystones.length) {
    sections.push(
      `Unestimated keystones (block critical-path planning): ${r.unestimatedKeystones.join(", ")}`
    );
  }
  if (r.unownedKeystones.length) {
    sections.push(
      `Unowned keystones (high leverage, no assignee): ${r.unownedKeystones.join(", ")}`
    );
  }
  if (r.isolated.length) {
    const shown = r.isolated.slice(0, 20).join(", ");
    const tail = r.isolated.length > 20 ? ` … (${r.isolated.length} total)` : "";
    sections.push(
      `Isolated (no recorded dependencies — try suggest_scope/suggest_links): ${shown}${tail}`
    );
  }
  if (!sections.length) return "No gaps found — the graph is clean.";
  return `Graph hygiene: ${r.summary}\n\n${sections.join("\n")}`;
}
```

- [ ] **Step 4: Register in `src/index.ts`**

Add import:
```ts
import { surfaceGapsTool } from "./tools/surfaceGaps.js";
```
Add registration after the `suggest_scope` registration:
```ts
  server.registerTool(
    "surface_gaps",
    {
      title: "Surface graph hygiene gaps",
      description:
        "Report deterministic planning gaps in a project's dependency graph: cycles, isolated tickets, and high-leverage (keystone) tickets missing an estimate or owner. Analysis only — asserts nothing, writes nothing. project_id accepts a name, slug, or UUID.",
      inputSchema: { project_id: projectId },
    },
    async ({ project_id }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await surfaceGapsTool(cache, id));
    }
  );
```

- [ ] **Step 5: Run tests + build + suite**
```bash
npx vitest run tests/tools/tools.test.ts
npm run build && npm test
```
Expected: type-clean; whole suite green; 8 `registerTool(` calls in src/index.ts.

- [ ] **Step 6: Docs**
- `README.md` tools table — add a row:
  `| \`surface_gaps\` | \`project_id\` | Reports graph hygiene gaps — cycles, isolated tickets, and keystones missing an estimate or owner. Deterministic; asserts/writes nothing. |`
- `docs/ROADMAP.md` — under Phase III, mark "Improvement / gap surfacing" ✅ (note: `surface_gaps` tool, deterministic; decomposition/grounding still ⬜). Update the closing status line.
- `docs/PHASE-III-SURFACE-GAPS.md` — change status to "implemented".
- `docs/ARCHITECTURE.md` — "seven tools" → "eight tools" everywhere; add `surface_gaps` to the tool list.

- [ ] **Step 7: Commit**
```bash
git add src/tools/surfaceGaps.ts src/index.ts tests/tools/tools.test.ts README.md docs/ROADMAP.md docs/PHASE-III-SURFACE-GAPS.md docs/ARCHITECTURE.md
git commit -m "feat: surface_gaps tool — deterministic graph hygiene report"
```

---

## Self-Review Notes

**Spec coverage** (against `PHASE-III-SURFACE-GAPS.md`):
- Four gap categories (cycles, isolated, unestimated keystones, unowned keystones) → Task 2 `findGaps`. ✓
- Composes `rankKeystones` + `detectCycle` → Task 2. ✓
- Linear `assignee` fetch + thread → Task 1. ✓
- Deterministic, analysis-only, no writes → `findGaps` pure; tool reads cache only. ✓
- Edge cases: no issues (tool), clean graph → "No gaps found" (Task 2 test + render), large isolated truncation (render). ✓
- Testing: findGaps synthetic graphs, normalize assignee, build threading, tool render. ✓

**Type consistency:** `assignee?: string | null` identical on `Issue` and `GraphNode`, defaulted `null`. `GapReport` defined in `gaps.ts`, consumed by the tool. `detectCycle` exported from `keystone.ts` (signature unchanged). "Keystone" = `leverage > 0`, consistent between spec and `findGaps`.

**Placeholder scan:** none — every step carries complete code and an expected result.

**Deferred (per spec):** stale-blocker gaps (needs `state.type`), inferred-unlinked coupling (already in suggest_links/scope), decompose_grounding + generative workflow.
```
