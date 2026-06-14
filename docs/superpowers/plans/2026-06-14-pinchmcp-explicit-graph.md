# PinchMCP Explicit-Graph Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a TypeScript stdio MCP server that pulls a Linear project's issues and blocking relations, builds an in-memory dependency graph, and ranks keystone tickets via dominator analysis with plain-language explanations.

**Architecture:** Three independently-testable layers. `linear/` fetches and normalizes Linear GraphQL data behind an `IssueSource` interface (the swap seam for an MCP-to-MCP client later). `graph/` holds pure functions: build a directed `FeatureGraph`, rank keystones via a dominator tree, walk blocker chains. `tools/` are thin handlers mapping MCP calls to graph functions and formatting explainable output. A per-`project_id` cache sits between them.

**Tech Stack:** Node 18+ (global `fetch`), TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `vitest`.

---

## File Structure

```
package.json            scripts, deps
tsconfig.json           ESM/NodeNext, strict
vitest.config.ts        test config
src/
  config.ts             load + validate LINEAR_API_KEY
  index.ts              MCP server entry: stdio transport, tool registration
  cache.ts              GraphCache: per-project_id built-graph cache
  linear/
    types.ts            Issue, Relation, RelationType
    source.ts           IssueSource interface + ProjectData
    client.ts           LinearGraphQLSource + normalizeProject
  graph/
    types.ts            GraphNode, Edge, FeatureGraph, KeystoneRanking, KeystoneEntry
    build.ts            buildFeatureGraph(issues, relations)
    keystone.ts         rankKeystones(graph) via dominator tree
    blockers.ts         explainBlockers(graph, ticketId)
  tools/
    buildFeatureGraph.ts
    rankKeystones.ts
    explainBlockers.ts
tests/
  graph/build.test.ts
  graph/keystone.test.ts
  graph/blockers.test.ts
  linear/normalize.test.ts
  cache.test.ts
  tools/tools.test.ts
  fixtures/linearProject.json
  fixtures/stubSource.ts
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `tests/sanity.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pinch-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "pinch-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `tests/sanity.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Install deps and run the sanity test**

Run: `npm install && npm test`
Expected: PASS, 1 test passing.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts tests/sanity.test.ts package-lock.json
git commit -m "chore: scaffold TypeScript MCP project with vitest"
```

---

## Task 2: Domain and Graph Types

**Files:**
- Create: `src/linear/types.ts`, `src/linear/source.ts`, `src/graph/types.ts`

No tests — these are type declarations consumed by later tasks.

- [ ] **Step 1: Create `src/linear/types.ts`**

```ts
export type RelationType = "blocks" | "blocked_by" | "related" | "duplicate";

export interface Issue {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  state: string;
  estimate: number | null; // stored, unused this slice
  branchName: string | null; // stored, unused this slice
}

export interface Relation {
  type: RelationType;
  fromIssueId: string; // issue the relation is declared on
  toIssueId: string; // the related issue
}
```

- [ ] **Step 2: Create `src/linear/source.ts`**

```ts
import { Issue, Relation } from "./types.js";

export interface ProjectData {
  issues: Issue[];
  relations: Relation[];
}

// The swap seam: a future MCP-to-MCP client implements the same interface.
export interface IssueSource {
  fetchProject(projectId: string): Promise<ProjectData>;
}
```

- [ ] **Step 3: Create `src/graph/types.ts`**

```ts
export interface GraphNode {
  id: string;
  identifier: string;
  title: string;
  state: string;
  estimate: number | null;
  branchName: string | null;
}

export interface Edge {
  from: string; // "from" unblocks "to" (to depends on from)
  to: string;
}

export interface FeatureGraph {
  nodes: Map<string, GraphNode>;
  edges: Edge[];
  successors: Map<string, Set<string>>; // from -> {to}
  predecessors: Map<string, Set<string>>; // to -> {from}
  relatedMeta: Map<string, Set<string>>; // undirected related/duplicate
}

export interface KeystoneEntry {
  id: string;
  identifier: string;
  title: string;
  leverage: number; // size of dominated subtree (gatekept downstream tickets)
  dominates: string[]; // identifiers of dominated tickets
  reachable: number; // transitive descendants in the flow graph (tiebreak)
}

export interface KeystoneRanking {
  ranked: KeystoneEntry[];
  warnings: string[];
  isolated: string[]; // node ids with no blocking edges
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/linear/types.ts src/linear/source.ts src/graph/types.ts
git commit -m "feat: add domain and graph types"
```

---

## Task 3: buildFeatureGraph

**Files:**
- Create: `src/graph/build.ts`
- Test: `tests/graph/build.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (id: string, identifier: string): Issue => ({
  id,
  identifier,
  title: `Title ${identifier}`,
  state: "Todo",
  estimate: null,
  branchName: null,
});

describe("buildFeatureGraph", () => {
  it("creates a node per issue", () => {
    const g = buildFeatureGraph([issue("a", "ENG-1"), issue("b", "ENG-2")], []);
    expect(g.nodes.size).toBe(2);
    expect(g.nodes.get("a")!.identifier).toBe("ENG-1");
  });

  it("normalizes 'blocks' to a from->to edge", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [{ type: "blocks", fromIssueId: "a", toIssueId: "b" }]
    );
    expect(g.edges).toEqual([{ from: "a", to: "b" }]);
    expect([...g.successors.get("a")!]).toEqual(["b"]);
    expect([...g.predecessors.get("b")!]).toEqual(["a"]);
  });

  it("normalizes 'blocked_by' by swapping direction", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [{ type: "blocked_by", fromIssueId: "a", toIssueId: "b" }]
    );
    // a is blocked by b => b unblocks a => edge b->a
    expect(g.edges).toEqual([{ from: "b", to: "a" }]);
  });

  it("de-duplicates equivalent edges", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [
        { type: "blocks", fromIssueId: "a", toIssueId: "b" },
        { type: "blocks", fromIssueId: "a", toIssueId: "b" },
      ]
    );
    expect(g.edges).toHaveLength(1);
  });

  it("keeps related/duplicate as metadata, not flow edges", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1"), issue("b", "ENG-2")],
      [{ type: "related", fromIssueId: "a", toIssueId: "b" }]
    );
    expect(g.edges).toHaveLength(0);
    expect([...g.relatedMeta.get("a")!]).toEqual(["b"]);
    expect([...g.relatedMeta.get("b")!]).toEqual(["a"]);
  });

  it("ignores edges referencing issues outside the project", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1")],
      [{ type: "blocks", fromIssueId: "a", toIssueId: "ghost" }]
    );
    expect(g.edges).toHaveLength(0);
  });

  it("ignores self-edges", () => {
    const g = buildFeatureGraph(
      [issue("a", "ENG-1")],
      [{ type: "blocks", fromIssueId: "a", toIssueId: "a" }]
    );
    expect(g.edges).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/build.test.ts`
Expected: FAIL — cannot find module `build.js`.

- [ ] **Step 3: Write `src/graph/build.ts`**

```ts
import { Issue, Relation } from "../linear/types.js";
import { Edge, FeatureGraph, GraphNode } from "./types.js";

export function buildFeatureGraph(
  issues: Issue[],
  relations: Relation[]
): FeatureGraph {
  const nodes = new Map<string, GraphNode>();
  for (const i of issues) {
    nodes.set(i.id, {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      state: i.state,
      estimate: i.estimate,
      branchName: i.branchName,
    });
  }

  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();
  const relatedMeta = new Map<string, Set<string>>();
  for (const id of nodes.keys()) {
    successors.set(id, new Set());
    predecessors.set(id, new Set());
    relatedMeta.set(id, new Set());
  }

  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (from: string, to: string) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to });
    successors.get(from)!.add(to);
    predecessors.get(to)!.add(from);
  };

  for (const r of relations) {
    switch (r.type) {
      case "blocks":
        addEdge(r.fromIssueId, r.toIssueId);
        break;
      case "blocked_by":
        addEdge(r.toIssueId, r.fromIssueId);
        break;
      case "related":
      case "duplicate":
        if (nodes.has(r.fromIssueId) && nodes.has(r.toIssueId)) {
          relatedMeta.get(r.fromIssueId)!.add(r.toIssueId);
          relatedMeta.get(r.toIssueId)!.add(r.fromIssueId);
        }
        break;
    }
  }

  return { nodes, edges, successors, predecessors, relatedMeta };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/build.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/build.ts tests/graph/build.test.ts
git commit -m "feat: build directed feature graph from issues and relations"
```

---

## Task 4: Keystone Ranking via Dominator Tree

**Files:**
- Create: `src/graph/keystone.ts`
- Test: `tests/graph/keystone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { rankKeystones } from "../../src/graph/keystone.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (id: string): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: `Title ${id}`,
  state: "Todo",
  estimate: null,
  branchName: null,
});
const blocks = (from: string, to: string): Relation => ({
  type: "blocks",
  fromIssueId: from,
  toIssueId: to,
});

const top = (ids: string[], rels: Relation[]) =>
  rankKeystones(buildFeatureGraph(ids.map(issue), rels)).ranked[0];

describe("rankKeystones", () => {
  it("ranks the head of a chain highest", () => {
    // a -> b -> c -> d
    const r = top(["a", "b", "c", "d"], [blocks("a", "b"), blocks("b", "c"), blocks("c", "d")]);
    expect(r.id).toBe("a");
    expect(r.leverage).toBe(3);
  });

  it("identifies a bottleneck as keystone even when other tickets precede it", () => {
    // a -> x, b -> x, x -> c, x -> d, x -> e
    // x is the dominator of c,d,e even though a and b come first.
    const ranking = rankKeystones(
      buildFeatureGraph(
        ["a", "b", "x", "c", "d", "e"].map(issue),
        [blocks("a", "x"), blocks("b", "x"), blocks("x", "c"), blocks("x", "d"), blocks("x", "e")]
      )
    );
    const x = ranking.ranked.find((e) => e.id === "x")!;
    const a = ranking.ranked.find((e) => e.id === "a")!;
    expect(ranking.ranked[0].id).toBe("x");
    expect(x.leverage).toBe(3); // dominates c, d, e
    // a reaches x,c,d,e (4 nodes) but dominates none — proves dominators != reachability
    expect(a.leverage).toBe(0);
    expect(a.reachable).toBe(4);
  });

  it("gives a diamond's apex full leverage", () => {
    // a -> b, a -> c, b -> d, c -> d
    const r = top(["a", "b", "c", "d"], [blocks("a", "b"), blocks("a", "c"), blocks("b", "d"), blocks("c", "d")]);
    expect(r.id).toBe("a");
    expect(r.leverage).toBe(3); // dominates b, c, d
  });

  it("reports isolated nodes and emits a no-structure warning when there are no edges", () => {
    const ranking = rankKeystones(buildFeatureGraph(["a", "b"].map(issue), []));
    expect(ranking.isolated.sort()).toEqual(["a", "b"]);
    expect(ranking.warnings.join(" ")).toMatch(/no dependency structure/i);
    expect(ranking.ranked.every((e) => e.leverage === 0)).toBe(true);
  });

  it("detects cycles and still returns a ranking", () => {
    // a -> b -> a
    const ranking = rankKeystones(buildFeatureGraph(["a", "b"].map(issue), [blocks("a", "b"), blocks("b", "a")]));
    expect(ranking.warnings.join(" ")).toMatch(/cycle/i);
    expect(ranking.ranked).toHaveLength(2);
  });

  it("lists dominated tickets by identifier", () => {
    const ranking = rankKeystones(buildFeatureGraph(["a", "b"].map(issue), [blocks("a", "b")]));
    const a = ranking.ranked.find((e) => e.id === "a")!;
    expect(a.dominates).toEqual(["B"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/keystone.test.ts`
Expected: FAIL — cannot find module `keystone.js`.

- [ ] **Step 3: Write `src/graph/keystone.ts`**

```ts
import { FeatureGraph, KeystoneEntry, KeystoneRanking } from "./types.js";

const ENTRY = "__ENTRY__";

export function rankKeystones(graph: FeatureGraph): KeystoneRanking {
  const nodeIds = [...graph.nodes.keys()];
  const warnings: string[] = [];

  const isolated = nodeIds.filter(
    (id) =>
      (graph.successors.get(id)?.size ?? 0) === 0 &&
      (graph.predecessors.get(id)?.size ?? 0) === 0
  );

  if (graph.edges.length === 0) {
    return {
      ranked: nodeIds.map((id) => entryFor(graph, id, [], 0)),
      warnings: ["No dependency structure found (no blocking relations)."],
      isolated,
    };
  }

  const cycleNodes = detectCycle(graph, nodeIds);
  if (cycleNodes.length > 0) {
    warnings.push(
      `Cycle detected among: ${cycleNodes
        .map((id) => graph.nodes.get(id)!.identifier)
        .join(", ")}. Keystone ranking proceeds but may be unreliable.`
    );
  }

  // Flow graph: virtual ENTRY -> every source node (in-degree 0).
  const succ = new Map<string, Set<string>>();
  succ.set(ENTRY, new Set());
  for (const id of nodeIds) succ.set(id, new Set(graph.successors.get(id) ?? []));
  for (const id of nodeIds) {
    if ((graph.predecessors.get(id)?.size ?? 0) === 0) succ.get(ENTRY)!.add(id);
  }

  const idom = computeIdom(ENTRY, succ);

  // Dom-tree children -> dominated lists.
  const domChildren = new Map<string, string[]>();
  for (const [n, d] of idom) {
    if (n === ENTRY) continue;
    if (!domChildren.has(d)) domChildren.set(d, []);
    domChildren.get(d)!.push(n);
  }
  const dominatedList = new Map<string, string[]>();
  const collect = (n: string): string[] => {
    let all: string[] = [];
    for (const k of domChildren.get(n) ?? []) all = all.concat([k], collect(k));
    dominatedList.set(n, all);
    return all;
  };
  collect(ENTRY);

  const ranked = nodeIds
    .map((id) => {
      const dominated = dominatedList.get(id) ?? [];
      return entryFor(
        graph,
        id,
        dominated.map((d) => graph.nodes.get(d)!.identifier),
        reachableCount(graph, id)
      );
    })
    .sort((a, b) => b.leverage - a.leverage || b.reachable - a.reachable);

  return { ranked, warnings, isolated };
}

function entryFor(
  graph: FeatureGraph,
  id: string,
  dominates: string[],
  reachable: number
): KeystoneEntry {
  const n = graph.nodes.get(id)!;
  return {
    id,
    identifier: n.identifier,
    title: n.title,
    leverage: dominates.length,
    dominates,
    reachable,
  };
}

// Cooper-Harvey-Kennedy "A Simple, Fast Dominance Algorithm".
function computeIdom(
  entry: string,
  succ: Map<string, Set<string>>
): Map<string, string> {
  const preds = new Map<string, Set<string>>();
  for (const n of succ.keys()) preds.set(n, new Set());
  for (const [u, vs] of succ) for (const v of vs) preds.get(v)!.add(u);

  // Iterative DFS postorder from entry.
  const visited = new Set<string>([entry]);
  const post: string[] = [];
  const stack: Array<[string, Iterator<string>]> = [
    [entry, succ.get(entry)!.values()],
  ];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const next = frame[1].next();
    if (next.done) {
      post.push(frame[0]);
      stack.pop();
    } else if (!visited.has(next.value)) {
      visited.add(next.value);
      stack.push([next.value, (succ.get(next.value) ?? new Set()).values()]);
    }
  }

  const postNum = new Map<string, number>();
  post.forEach((n, i) => postNum.set(n, i)); // entry has the highest number
  const rpo = [...post].reverse(); // entry first

  const idom = new Map<string, string>();
  idom.set(entry, entry);

  const intersect = (a: string, b: string): string => {
    let f1 = a;
    let f2 = b;
    while (f1 !== f2) {
      while (postNum.get(f1)! < postNum.get(f2)!) f1 = idom.get(f1)!;
      while (postNum.get(f2)! < postNum.get(f1)!) f2 = idom.get(f2)!;
    }
    return f1;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rpo) {
      if (b === entry || !visited.has(b)) continue;
      let newIdom: string | undefined;
      for (const p of preds.get(b) ?? []) {
        if (idom.has(p)) newIdom = newIdom === undefined ? p : intersect(p, newIdom);
      }
      if (newIdom !== undefined && idom.get(b) !== newIdom) {
        idom.set(b, newIdom);
        changed = true;
      }
    }
  }
  return idom;
}

function detectCycle(graph: FeatureGraph, nodeIds: string[]): string[] {
  const indeg = new Map<string, number>();
  for (const id of nodeIds) indeg.set(id, graph.predecessors.get(id)?.size ?? 0);
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  let removed = 0;
  while (queue.length) {
    const n = queue.shift()!;
    removed++;
    for (const m of graph.successors.get(n) ?? []) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  if (removed === nodeIds.length) return [];
  return nodeIds.filter((id) => indeg.get(id)! > 0);
}

function reachableCount(graph: FeatureGraph, start: string): number {
  const seen = new Set<string>();
  const stack = [...(graph.successors.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of graph.successors.get(n) ?? []) if (!seen.has(m)) stack.push(m);
  }
  return seen.size;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/keystone.test.ts`
Expected: PASS, 6 tests. The bottleneck test is the key proof that dominators differ from reachability.

- [ ] **Step 5: Commit**

```bash
git add src/graph/keystone.ts tests/graph/keystone.test.ts
git commit -m "feat: rank keystones via dominator tree"
```

---

## Task 5: explain_blockers Chain Walk

**Files:**
- Create: `src/graph/blockers.ts`
- Test: `tests/graph/blockers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildFeatureGraph } from "../../src/graph/build.js";
import { explainBlockers } from "../../src/graph/blockers.js";
import { Issue, Relation } from "../../src/linear/types.js";

const issue = (id: string): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: `Title ${id}`,
  state: "Todo",
  estimate: null,
  branchName: null,
});
const blocks = (from: string, to: string): Relation => ({
  type: "blocks",
  fromIssueId: from,
  toIssueId: to,
});

// a -> b -> c
const graph = () =>
  buildFeatureGraph(["a", "b", "c"].map(issue), [blocks("a", "b"), blocks("b", "c")]);

describe("explainBlockers", () => {
  it("walks transitive upstream and downstream by Linear id", () => {
    const e = explainBlockers(graph(), "b");
    expect(e.found).toBe(true);
    expect(e.upstream).toEqual(["A"]);
    expect(e.downstream).toEqual(["C"]);
  });

  it("resolves a ticket by identifier too", () => {
    const e = explainBlockers(graph(), "A");
    expect(e.found).toBe(true);
    expect(e.upstream).toEqual([]);
    expect(e.downstream.sort()).toEqual(["B", "C"]);
  });

  it("summarizes counts", () => {
    const e = explainBlockers(graph(), "a");
    expect(e.summary).toMatch(/blocked by 0/i);
    expect(e.summary).toMatch(/unblocks 2/i);
  });

  it("returns found=false for an unknown ticket", () => {
    const e = explainBlockers(graph(), "zzz");
    expect(e.found).toBe(false);
    expect(e.summary).toMatch(/not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/blockers.test.ts`
Expected: FAIL — cannot find module `blockers.js`.

- [ ] **Step 3: Write `src/graph/blockers.ts`**

```ts
import { FeatureGraph, GraphNode } from "./types.js";

export interface BlockerExplanation {
  ticket: string; // identifier
  title: string;
  upstream: string[]; // identifiers that transitively block it
  downstream: string[]; // identifiers it transitively unblocks
  summary: string;
  found: boolean;
}

export function explainBlockers(
  graph: FeatureGraph,
  ticketKey: string
): BlockerExplanation {
  const node = resolve(graph, ticketKey);
  if (!node) {
    return {
      ticket: ticketKey,
      title: "",
      upstream: [],
      downstream: [],
      summary: `Ticket ${ticketKey} not found in graph.`,
      found: false,
    };
  }

  const toIdents = (ids: Set<string>) =>
    [...ids].map((id) => graph.nodes.get(id)!.identifier).sort();
  const upstream = toIdents(walk(graph, node.id, graph.predecessors));
  const downstream = toIdents(walk(graph, node.id, graph.successors));

  return {
    ticket: node.identifier,
    title: node.title,
    upstream,
    downstream,
    summary: `${node.identifier} is blocked by ${upstream.length} ticket(s) and unblocks ${downstream.length} ticket(s).`,
    found: true,
  };
}

function resolve(graph: FeatureGraph, key: string): GraphNode | undefined {
  if (graph.nodes.has(key)) return graph.nodes.get(key);
  for (const n of graph.nodes.values()) if (n.identifier === key) return n;
  return undefined;
}

function walk(
  graph: FeatureGraph,
  start: string,
  adj: Map<string, Set<string>>
): Set<string> {
  const seen = new Set<string>();
  const stack = [...(adj.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) stack.push(m);
  }
  return seen;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/blockers.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/graph/blockers.ts tests/graph/blockers.test.ts
git commit -m "feat: explain blockers via transitive chain walk"
```

---

## Task 6: Linear GraphQL Source + Normalization

**Files:**
- Create: `src/linear/client.ts`
- Create: `tests/fixtures/linearProject.json`
- Test: `tests/linear/normalize.test.ts`

- [ ] **Step 1: Create the fixture `tests/fixtures/linearProject.json`**

This is a recorded shape of Linear's GraphQL `project` payload. `ENG-1` blocks `ENG-2`; `ENG-3` is related to `ENG-1`; one relation points outside the project (`ghost`) and must be dropped.

```json
{
  "issues": {
    "nodes": [
      {
        "id": "i1",
        "identifier": "ENG-1",
        "title": "Auth refactor",
        "estimate": 3,
        "branchName": "eng-1-auth-refactor",
        "state": { "name": "In Progress" },
        "relations": {
          "nodes": [
            { "type": "blocks", "relatedIssue": { "id": "i2" } },
            { "type": "blocks", "relatedIssue": { "id": "ghost" } }
          ]
        }
      },
      {
        "id": "i2",
        "identifier": "ENG-2",
        "title": "Session store",
        "estimate": null,
        "branchName": null,
        "state": { "name": "Todo" },
        "relations": { "nodes": [] }
      },
      {
        "id": "i3",
        "identifier": "ENG-3",
        "title": "Login page",
        "estimate": 2,
        "branchName": null,
        "state": { "name": "Todo" },
        "relations": {
          "nodes": [{ "type": "related", "relatedIssue": { "id": "i1" } }]
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test `tests/linear/normalize.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { normalizeProject } from "../../src/linear/client.js";
import fixture from "../fixtures/linearProject.json";

describe("normalizeProject", () => {
  const data = normalizeProject(fixture);

  it("maps issues with state name, estimate and branchName", () => {
    expect(data.issues).toHaveLength(3);
    const eng1 = data.issues.find((i) => i.identifier === "ENG-1")!;
    expect(eng1.id).toBe("i1");
    expect(eng1.state).toBe("In Progress");
    expect(eng1.estimate).toBe(3);
    expect(eng1.branchName).toBe("eng-1-auth-refactor");
  });

  it("defaults missing estimate/branchName to null", () => {
    const eng2 = data.issues.find((i) => i.identifier === "ENG-2")!;
    expect(eng2.estimate).toBeNull();
    expect(eng2.branchName).toBeNull();
  });

  it("produces a blocks relation from source to relatedIssue", () => {
    const blocks = data.relations.filter((r) => r.type === "blocks");
    expect(blocks).toContainEqual({ type: "blocks", fromIssueId: "i1", toIssueId: "i2" });
  });

  it("keeps the out-of-project relation (build layer filters it)", () => {
    // normalize does not know the project membership boundary beyond what is
    // present; the ghost relation is emitted and dropped later by buildFeatureGraph.
    expect(data.relations).toContainEqual({ type: "blocks", fromIssueId: "i1", toIssueId: "ghost" });
  });

  it("maps related relations", () => {
    expect(data.relations).toContainEqual({ type: "related", fromIssueId: "i3", toIssueId: "i1" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/linear/normalize.test.ts`
Expected: FAIL — cannot find module `client.js`.

- [ ] **Step 4: Write `src/linear/client.ts`**

```ts
import { IssueSource, ProjectData } from "./source.js";
import { Issue, Relation, RelationType } from "./types.js";

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

const QUERY = `query($id: String!) {
  project(id: $id) {
    issues(first: 250) {
      nodes {
        id
        identifier
        title
        estimate
        branchName
        state { name }
        relations { nodes { type relatedIssue { id } } }
      }
    }
  }
}`;

export class LinearGraphQLSource implements IssueSource {
  constructor(
    private apiKey: string,
    private fetchFn: typeof fetch = fetch
  ) {}

  async fetchProject(projectId: string): Promise<ProjectData> {
    const res = await this.fetchFn(LINEAR_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query: QUERY, variables: { id: projectId } }),
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: { project?: unknown };
      errors?: unknown;
    };
    if (json.errors) {
      throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    if (!json.data?.project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return normalizeProject(json.data.project);
  }
}

export function normalizeProject(project: any): ProjectData {
  const issueNodes: any[] = project?.issues?.nodes ?? [];

  const issues: Issue[] = issueNodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    state: n.state?.name ?? "unknown",
    estimate: n.estimate ?? null,
    branchName: n.branchName ?? null,
  }));

  const relations: Relation[] = [];
  const seen = new Set<string>();
  for (const n of issueNodes) {
    for (const r of n.relations?.nodes ?? []) {
      const target = r.relatedIssue?.id;
      if (!target) continue;
      const type = mapRelationType(r.type);
      if (!type) continue;
      const key = `${n.id}:${type}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({ type, fromIssueId: n.id, toIssueId: target });
    }
  }

  return { issues, relations };
}

function mapRelationType(t: string): RelationType | null {
  switch (t) {
    case "blocks":
      return "blocks";
    case "blocked":
    case "blocked_by":
      return "blocked_by";
    case "related":
      return "related";
    case "duplicate":
      return "duplicate";
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/linear/normalize.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/linear/client.ts tests/linear/normalize.test.ts tests/fixtures/linearProject.json
git commit -m "feat: Linear GraphQL source with response normalization"
```

---

## Task 7: GraphCache

**Files:**
- Create: `src/cache.ts`
- Create: `tests/fixtures/stubSource.ts`
- Test: `tests/cache.test.ts`

- [ ] **Step 1: Create the test stub `tests/fixtures/stubSource.ts`**

```ts
import { IssueSource, ProjectData } from "../../src/linear/source.js";

export class StubSource implements IssueSource {
  public calls = 0;
  constructor(private data: ProjectData) {}
  async fetchProject(_projectId: string): Promise<ProjectData> {
    this.calls++;
    return this.data;
  }
}

export const sampleProject: ProjectData = {
  issues: [
    { id: "a", identifier: "ENG-1", title: "Auth", state: "Todo", estimate: null, branchName: null },
    { id: "b", identifier: "ENG-2", title: "Session", state: "Todo", estimate: null, branchName: null },
    { id: "c", identifier: "ENG-3", title: "Login", state: "Todo", estimate: null, branchName: null },
  ],
  relations: [
    { type: "blocks", fromIssueId: "a", toIssueId: "b" },
    { type: "blocks", fromIssueId: "a", toIssueId: "c" },
  ],
};
```

- [ ] **Step 2: Write the failing test `tests/cache.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { GraphCache } from "../src/cache.js";
import { StubSource, sampleProject } from "./fixtures/stubSource.js";

describe("GraphCache", () => {
  it("builds and caches per project (one fetch for repeated reads)", async () => {
    const source = new StubSource(sampleProject);
    const cache = new GraphCache(source);
    const g1 = await cache.getOrBuild("p1");
    const g2 = await cache.getOrBuild("p1");
    expect(g1).toBe(g2);
    expect(source.calls).toBe(1);
    expect(g1.nodes.size).toBe(3);
  });

  it("rebuild re-fetches and replaces the cached graph", async () => {
    const source = new StubSource(sampleProject);
    const cache = new GraphCache(source);
    await cache.getOrBuild("p1");
    await cache.rebuild("p1");
    expect(source.calls).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/cache.test.ts`
Expected: FAIL — cannot find module `cache.js`.

- [ ] **Step 4: Write `src/cache.ts`**

```ts
import { IssueSource } from "./linear/source.js";
import { buildFeatureGraph } from "./graph/build.js";
import { FeatureGraph } from "./graph/types.js";

export class GraphCache {
  private cache = new Map<string, FeatureGraph>();
  constructor(private source: IssueSource) {}

  async getOrBuild(projectId: string): Promise<FeatureGraph> {
    const existing = this.cache.get(projectId);
    if (existing) return existing;
    return this.rebuild(projectId);
  }

  async rebuild(projectId: string): Promise<FeatureGraph> {
    const { issues, relations } = await this.source.fetchProject(projectId);
    const graph = buildFeatureGraph(issues, relations);
    this.cache.set(projectId, graph);
    return graph;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cache.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/cache.ts tests/cache.test.ts tests/fixtures/stubSource.ts
git commit -m "feat: per-project graph cache"
```

---

## Task 8: Tool Handlers

**Files:**
- Create: `src/tools/buildFeatureGraph.ts`, `src/tools/rankKeystones.ts`, `src/tools/explainBlockers.ts`
- Test: `tests/tools/tools.test.ts`

- [ ] **Step 1: Write the failing test `tests/tools/tools.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { GraphCache } from "../../src/cache.js";
import { StubSource, sampleProject } from "../fixtures/stubSource.js";
import { buildFeatureGraphTool } from "../../src/tools/buildFeatureGraph.js";
import { rankKeystonesTool } from "../../src/tools/rankKeystones.js";
import { explainBlockersTool } from "../../src/tools/explainBlockers.js";

const newCache = () => new GraphCache(new StubSource(sampleProject));

describe("tool handlers", () => {
  it("build_feature_graph reports node and edge counts", async () => {
    const r = await buildFeatureGraphTool(newCache(), "p1");
    expect(r.text).toMatch(/3 issues/);
    expect(r.text).toMatch(/2 blocking edges/);
  });

  it("rank_keystones names the keystone and explains it", async () => {
    const r = await rankKeystonesTool(newCache(), "p1");
    // ENG-1 (a) dominates ENG-2 and ENG-3.
    expect(r.text).toMatch(/ENG-1/);
    expect(r.text).toMatch(/leverage 2/);
    expect(r.text).toMatch(/passes through it/);
  });

  it("explain_blockers describes upstream and downstream", async () => {
    const r = await explainBlockersTool(newCache(), "p1", "ENG-2");
    expect(r.text).toMatch(/ENG-2 is blocked by 1/);
    expect(r.text).toMatch(/ENG-1/);
  });

  it("explain_blockers reports a missing ticket cleanly", async () => {
    const r = await explainBlockersTool(newCache(), "p1", "ENG-999");
    expect(r.text).toMatch(/not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/tools.test.ts`
Expected: FAIL — cannot find the tool modules.

- [ ] **Step 3: Write `src/tools/buildFeatureGraph.ts`**

```ts
import { GraphCache } from "../cache.js";

export interface ToolResult {
  text: string;
  structured: unknown;
}

export async function buildFeatureGraphTool(
  cache: GraphCache,
  projectId: string
): Promise<ToolResult> {
  const g = await cache.rebuild(projectId);
  return {
    text: `Built feature graph for ${projectId}: ${g.nodes.size} issues, ${g.edges.length} blocking edges.`,
    structured: { nodes: g.nodes.size, edges: g.edges.length },
  };
}
```

- [ ] **Step 4: Write `src/tools/rankKeystones.ts`**

```ts
import { GraphCache } from "../cache.js";
import { rankKeystones } from "../graph/keystone.js";
import { ToolResult } from "./buildFeatureGraph.js";

export async function rankKeystonesTool(
  cache: GraphCache,
  projectId: string
): Promise<ToolResult> {
  const g = await cache.getOrBuild(projectId);
  const ranking = rankKeystones(g);

  const lines = ranking.ranked.slice(0, 5).map((e, i) => {
    if (e.leverage > 0) {
      return `${i + 1}. ${e.identifier} "${e.title}" — leverage ${e.leverage}: every path to ${e.dominates.join(", ")} passes through it.`;
    }
    return `${i + 1}. ${e.identifier} "${e.title}" — leverage 0 (gatekeeps nothing downstream).`;
  });

  let text = `Keystone ranking for ${projectId}:\n${lines.join("\n")}`;
  if (ranking.warnings.length) {
    text += `\n\nWarnings:\n- ${ranking.warnings.join("\n- ")}`;
  }
  if (ranking.isolated.length) {
    const idents = ranking.isolated.map((id) => g.nodes.get(id)!.identifier);
    text += `\n\nUngrounded (no dependency signal): ${idents.join(", ")}`;
  }

  return { text, structured: ranking };
}
```

- [ ] **Step 5: Write `src/tools/explainBlockers.ts`**

```ts
import { GraphCache } from "../cache.js";
import { explainBlockers } from "../graph/blockers.js";
import { ToolResult } from "./buildFeatureGraph.js";

export async function explainBlockersTool(
  cache: GraphCache,
  projectId: string,
  ticketId: string
): Promise<ToolResult> {
  const g = await cache.getOrBuild(projectId);
  const e = explainBlockers(g, ticketId);
  if (!e.found) {
    return { text: e.summary, structured: e };
  }

  let text = e.summary;
  if (e.upstream.length) {
    text += `\n\nBlocked by (must finish first): ${e.upstream.join(", ")}`;
  }
  if (e.downstream.length) {
    text += `\n\nUnblocks (downstream): ${e.downstream.join(", ")}`;
  }
  return { text, structured: e };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/tools/tools.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/tools tests/tools/tools.test.ts
git commit -m "feat: tool handlers with explainable formatting"
```

---

## Task 9: Config + MCP Server Wiring

**Files:**
- Create: `src/config.ts`, `src/index.ts`
- Create: `.env.example`, `README.md`

- [ ] **Step 1: Write `src/config.ts`**

```ts
export interface Config {
  linearApiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const linearApiKey = env.LINEAR_API_KEY;
  if (!linearApiKey) {
    throw new Error("LINEAR_API_KEY environment variable is required.");
  }
  return { linearApiKey };
}
```

- [ ] **Step 2: Write a config test `tests/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("reads LINEAR_API_KEY", () => {
    expect(loadConfig({ LINEAR_API_KEY: "lin_abc" }).linearApiKey).toBe("lin_abc");
  });

  it("throws a clear error when the key is missing", () => {
    expect(() => loadConfig({})).toThrow(/LINEAR_API_KEY/);
  });
});
```

- [ ] **Step 3: Run the config test**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 4: Write `src/index.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { LinearGraphQLSource } from "./linear/client.js";
import { GraphCache } from "./cache.js";
import { buildFeatureGraphTool, ToolResult } from "./tools/buildFeatureGraph.js";
import { rankKeystonesTool } from "./tools/rankKeystones.js";
import { explainBlockersTool } from "./tools/explainBlockers.js";

function textResult(r: ToolResult) {
  return { content: [{ type: "text" as const, text: r.text }] };
}

async function main() {
  const config = loadConfig();
  const source = new LinearGraphQLSource(config.linearApiKey);
  const cache = new GraphCache(source);

  const server = new McpServer({ name: "pinch-mcp", version: "0.1.0" });

  server.registerTool(
    "build_feature_graph",
    {
      title: "Build feature graph",
      description:
        "Fetch a Linear project's issues and blocking relations and (re)build the in-memory dependency graph.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) =>
      textResult(await buildFeatureGraphTool(cache, project_id))
  );

  server.registerTool(
    "rank_keystones",
    {
      title: "Rank keystone tickets",
      description:
        "Rank tickets by leverage: how much downstream work each one gatekeeps, via dominator analysis of the blocking graph.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) =>
      textResult(await rankKeystonesTool(cache, project_id))
  );

  server.registerTool(
    "explain_blockers",
    {
      title: "Explain a ticket's blockers",
      description:
        "Show what transitively blocks a ticket and what it transitively unblocks.",
      inputSchema: { project_id: z.string(), ticket_id: z.string() },
    },
    async ({ project_id, ticket_id }) =>
      textResult(await explainBlockersTool(cache, project_id, ticket_id))
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Write `.env.example`**

```
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 6: Write `README.md`**

```markdown
# PinchMCP

An MCP server that finds the **keystone** ticket in a Linear feature — the one
that, once done, unblocks the most downstream work — via dominator analysis of
the blocking-relation graph.

This is slice 1: the explicit-graph path. Code-coupling inference comes later.

## Tools

- `build_feature_graph(project_id)` — fetch issues + relations, build the graph.
- `rank_keystones(project_id)` — rank tickets by downstream leverage, with
  plain-language explanations.
- `explain_blockers(project_id, ticket_id)` — transitive blockers and unblocks
  for one ticket.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `LINEAR_API_KEY` (Linear → Settings →
   Security & access → Personal API keys).
3. `npm run build`

## Run

The server speaks MCP over stdio. Register it with your MCP client (e.g. Claude
Code) pointing at `dist/index.js`, with `LINEAR_API_KEY` set in the environment.

## Develop

- `npm test` — run the test suite.
- `npm run dev` — run from source via tsx.
```

- [ ] **Step 7: Build, run the full suite, and do a startup smoke check**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

Run: `LINEAR_API_KEY=dummy node dist/index.js < /dev/null`
Expected: process starts, reads no input from the closed stdin, and exits without throwing (it connects the stdio transport then EOFs). A missing-key run `node dist/index.js < /dev/null` should instead print the `LINEAR_API_KEY` error and exit 1.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/index.ts tests/config.test.ts .env.example README.md
git commit -m "feat: config loader and stdio MCP server entrypoint"
```

---

## Manual Verification (after Task 9)

Against a real Linear project (10–40 tickets with some blocking relations):

1. Build: `npm run build`.
2. Register the server with Claude Code (or run via the MCP inspector) with a real `LINEAR_API_KEY`.
3. Call `build_feature_graph` with a real `project_id` — expect a count of issues and edges that matches the project.
4. Call `rank_keystones` — expect the top ticket to be one that visibly gates downstream work, with an explanation listing the tickets it dominates.
5. Call `explain_blockers` on a mid-chain ticket — expect correct upstream/downstream sets.

This proves the explicit-graph path end-to-end, the goal of this slice.

---

## Self-Review Notes

**Spec coverage check:**
- Architecture (3 layers, stdio) → Tasks 2, 6, 7, 8, 9. ✓
- `IssueSource` swap seam → Task 2 (`source.ts`), Task 6 (implementation). ✓
- Graph semantics (canonical direction, related-as-metadata, in-project filtering, de-dup) → Task 3. ✓
- Keystone via dominator tree, virtual ENTRY, leverage = subtree size, reachability tiebreak → Task 4. ✓
- Edge cases: cycles, isolated nodes, empty/no-relations → Task 4 tests + Task 8 formatting. ✓
- `explain_blockers` upstream/downstream + summary → Task 5. ✓
- Per-project cache → Task 7. ✓
- Three tools registered → Task 9. ✓
- Error handling (missing key, project not found, API error) → Task 6 (client), Task 9 (config). ✓
- Testing (synthetic graph fixtures, recorded JSON, stub source) → Tasks 3–8. ✓
- `critical_path` deferred → not in plan, by design. ✓

**Type consistency check:** `ToolResult` defined in Task 8 (`buildFeatureGraph.ts`) and imported by the other two tools and `index.ts`. `FeatureGraph`/`KeystoneRanking`/`KeystoneEntry` defined in Task 2, used consistently in Tasks 4, 8. `IssueSource`/`ProjectData` defined Task 2, implemented Task 6, consumed Task 7. `BlockerExplanation` defined and used in Task 5. No naming drift found.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step states the expected result.
