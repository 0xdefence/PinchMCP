# Phase II-b.2 — Attachment-based ticket→code mapping (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map Linear tickets to code via the **PR they're attached to** (Linear's GitHub integration), not just commit messages that cite the ticket ID — recovering the ~18/20 tickets that mapped to nothing on the real repo.

**Architecture:** Additive. Fetch each issue's attachments from Linear, extract GitHub PR numbers from the URLs, thread `prNumbers` through `Issue → GraphNode → IssueRef`, and have `mapTicketsToFiles` also match commits whose squash-merge subject contains `(#N)`. PR→files is git-only (verified: 0xDefend squash-merges with `(#N)`). Nothing in keystone/CPM/suggest-links scoring changes.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import suffixes), vitest. No new dependencies.

## Global Constraints

- TS ESM NodeNext; relative imports use `.js`. Build type-clean (`noEmitOnError`, `types:["node"]`).
- `prNumbers` is an **optional** field (`prNumbers?: number[]`) on `Issue`, `GraphNode`, and `IssueRef` so existing object literals across the test suite keep compiling; production code (`normalizeProject`, `buildFeatureGraph`, `suggestLinksTool`) always populates it, and consumers default with `?? []`.
- The PR-number commit match is the fixed string `(#N)` — e.g. issue with `prNumbers:[44]` matches a commit subject containing `(#44)`, even with no ticket identifier present.
- Single test: `npx vitest run <path>`; whole suite: `npm test`.
- Inferred coupling still never enters `FeatureGraph`; this only widens ticket→file coverage.

---

## File Structure

```
src/linear/types.ts        Issue gains prNumbers?: number[]
src/linear/client.ts       query adds attachments(first:25){nodes{url}}; normalizeProject extracts prNumbers
src/graph/types.ts         GraphNode gains prNumbers?: number[]
src/graph/build.ts         thread prNumbers onto the node
src/code/ticketMap.ts      IssueRef gains prNumbers?; mapTicketsToFiles adds (#N) matching
src/tools/suggestLinks.ts  build IssueRef with prNumbers from graph.nodes
tests/linear/normalize.test.ts   prNumbers extraction tests
tests/graph/build.test.ts        prNumbers threaded
tests/code/ticketMap.test.ts     map via PR number
docs/ROADMAP.md, docs/PHASE-IIb2-ATTACHMENT-MAPPING.md   status
```

---

## Task 1: Linear — fetch attachments, extract PR numbers

**Files:**
- Modify: `src/linear/types.ts`, `src/linear/client.ts`
- Test: `tests/linear/normalize.test.ts`

**Interfaces:**
- Produces: `Issue.prNumbers?: number[]`; `normalizeProject` populates it from `issue.attachments.nodes[].url` (GitHub `/pull/<N>` URLs, deduped).

> **Live-schema note for the implementer:** the design targets
> `issue.attachments.nodes[].url` holding the PR URL. The PR-number extraction is
> isolated in a small `extractPrNumbers(attachmentNodes)` helper. If a live test
> shows the PR URL lives elsewhere (e.g. `metadata`), only that helper + the query
> field change.

- [ ] **Step 1: Add the field in `src/linear/types.ts`**

In `interface Issue`, add after `branchName`:
```ts
  prNumbers?: number[]; // GitHub PR numbers from Linear attachments
```

- [ ] **Step 2: Write the failing tests in `tests/linear/normalize.test.ts`**

Add inside `describe("normalizeProject", ...)`:
```ts
  it("extracts GitHub PR numbers from issue attachments", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1", identifier: "ENG-9", title: "T", estimate: null,
            branchName: null, state: { name: "Todo" },
            relations: { nodes: [] },
            attachments: {
              nodes: [
                { url: "https://github.com/0xdefence/0xDefend/pull/44" },
                { url: "https://github.com/0xdefence/0xDefend/pull/44" }, // dup
                { url: "https://linear.app/whatever" }, // not a PR
              ],
            },
          },
        ],
      },
    });
    expect(data.issues[0].prNumbers).toEqual([44]);
  });

  it("defaults prNumbers to [] when there are no attachments", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1", identifier: "ENG-9", title: "T", estimate: null,
            branchName: null, state: { name: "Todo" }, relations: { nodes: [] },
          },
        ],
      },
    });
    expect(data.issues[0].prNumbers).toEqual([]);
  });
```

- [ ] **Step 3: Run, expect FAIL** (`prNumbers` undefined / not extracted).

Run: `npx vitest run tests/linear/normalize.test.ts`

- [ ] **Step 4: Update `src/linear/client.ts`**

In `QUERY`, add `attachments` to the issue node selection (right after the `relations(...)` line):
```
        relations(first: ${RELATION_LIMIT}) { nodes { type relatedIssue { id } } }
        attachments(first: 25) { nodes { url } }
```

In `normalizeProject`, set `prNumbers` in the issue map and add the helper. Change the `issues` map to include:
```ts
    prNumbers: extractPrNumbers(n.attachments?.nodes ?? []),
```
And add this helper near `mapRelationType`:
```ts
function extractPrNumbers(nodes: any[]): number[] {
  const nums = new Set<number>();
  for (const a of nodes) {
    const m = String(a?.url ?? "").match(
      /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i
    );
    if (m) nums.add(Number(m[1]));
  }
  return [...nums];
}
```

- [ ] **Step 5: Run, expect PASS** (both new tests + all existing normalize tests).

Run: `npx vitest run tests/linear/normalize.test.ts`

- [ ] **Step 6: Commit**
```bash
git add src/linear/types.ts src/linear/client.ts tests/linear/normalize.test.ts
git commit -m "feat(linear): extract GitHub PR numbers from issue attachments"
```

---

## Task 2: Thread prNumbers through graph → code → tool

**Files:**
- Modify: `src/graph/types.ts`, `src/graph/build.ts`, `src/code/ticketMap.ts`, `src/tools/suggestLinks.ts`
- Test: `tests/graph/build.test.ts`, `tests/code/ticketMap.test.ts`
- Modify: `docs/ROADMAP.md`, `docs/PHASE-IIb2-ATTACHMENT-MAPPING.md`

**Interfaces:**
- Consumes: `Issue.prNumbers?` (Task 1).
- Produces: `GraphNode.prNumbers?: number[]`; `IssueRef.prNumbers?: number[]`; `mapTicketsToFiles` matches `(#N)` for each issue PR number.

- [ ] **Step 1: Write the failing test in `tests/graph/build.test.ts`**

The existing `issue` helper there is `(id, identifier) => ({...})`. Add a new test that passes prNumbers explicitly:
```ts
  it("threads prNumbers onto the graph node", () => {
    const g = buildFeatureGraph(
      [{ id: "a", identifier: "ENG-1", title: "t", state: "Todo", estimate: null, branchName: null, prNumbers: [44] }],
      []
    );
    expect(g.nodes.get("a")!.prNumbers).toEqual([44]);
  });

  it("defaults node prNumbers to [] when the issue has none", () => {
    const g = buildFeatureGraph([issue("a", "ENG-1")], []);
    expect(g.nodes.get("a")!.prNumbers).toEqual([]);
  });
```

- [ ] **Step 2: Write the failing test in `tests/code/ticketMap.test.ts`**

Add inside the describe block:
```ts
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
```

- [ ] **Step 3: Run both, expect FAIL.**

Run: `npx vitest run tests/graph/build.test.ts tests/code/ticketMap.test.ts`

- [ ] **Step 4: Add the field in `src/graph/types.ts`**

In `interface GraphNode`, add after `branchName`:
```ts
  prNumbers?: number[];
```

- [ ] **Step 5: Thread it in `src/graph/build.ts`**

In the node-construction object (where `branchName: i.branchName` is set), add:
```ts
      prNumbers: i.prNumbers ?? [],
```

- [ ] **Step 6: Extend `src/code/ticketMap.ts`**

In `interface IssueRef`, add:
```ts
  prNumbers?: number[];
```
In `mapTicketsToFiles`, after the `branchName` pattern push, add PR-number patterns:
```ts
    for (const pr of iss.prNumbers ?? []) {
      patterns.push(new RegExp(`\\(#${pr}\\)`));
    }
```

- [ ] **Step 7: Wire `src/tools/suggestLinks.ts`**

In the `issues: IssueRef[]` map (built from `graph.nodes.values()`), add `prNumbers`:
```ts
  const issues: IssueRef[] = [...graph.nodes.values()].map((n) => ({
    id: n.id,
    identifier: n.identifier,
    branchName: n.branchName,
    prNumbers: n.prNumbers ?? [],
  }));
```

- [ ] **Step 8: Run tests + full suite + build**

Run: `npx vitest run tests/graph/build.test.ts tests/code/ticketMap.test.ts`
Run: `npm run build && npm test`
Expected: build type-clean; whole suite green.

- [ ] **Step 9: Update docs**
- In `docs/ROADMAP.md`, under Phase II-b, append a sub-bullet to the ticket→code line:
  `✅ Ticket → code mapping — identifier/branch commit refs **plus Linear attachment PR numbers** (`(#N)` squash-merge match)`
- In `docs/PHASE-IIb2-ATTACHMENT-MAPPING.md`, change the status line from `pre-implementation` to `implemented`.

- [ ] **Step 10: Commit**
```bash
git add src/graph/types.ts src/graph/build.ts src/code/ticketMap.ts src/tools/suggestLinks.ts tests/graph/build.test.ts tests/code/ticketMap.test.ts docs/ROADMAP.md docs/PHASE-IIb2-ATTACHMENT-MAPPING.md
git commit -m "feat(code): map tickets to files via attached PR numbers"
```

---

## Self-Review Notes

**Spec coverage** (against `PHASE-IIb2-ATTACHMENT-MAPPING.md`):
- Attachments fetched + PR numbers extracted (documented schema, isolated helper) → Task 1. ✓
- `prNumbers` threaded Issue→GraphNode→IssueRef → Task 2 steps 4–7. ✓
- `mapTicketsToFiles` unions ID/branch + `(#N)` PR match → Task 2 step 6. ✓
- git-only PR→files (no gh) → the `(#N)` match against commit subjects; no GitHub API used. ✓
- Edge cases: no attachments → `[]` (Task 1 test); non-PR attachment ignored (Task 1 test); wrong PR number no-match (Task 2 test). ✓
- Augment-not-replace: existing identifier/branch patterns untouched; PR patterns appended. ✓

**Type consistency:** `prNumbers?: number[]` identical on `Issue`, `GraphNode`, `IssueRef`. `normalizeProject`/`buildFeatureGraph`/`suggestLinksTool` always populate it; consumers use `?? []`. `extractPrNumbers` is the single schema-coupled point.

**Placeholder scan:** none — every step has complete code and an expected result.

**Live-schema risk (owner-tested):** the only unverified assumption is the attachment GraphQL shape; it is isolated to the query field + `extractPrNumbers`. If the live test shows a different shape, those two spots adjust and the rest of the plan stands.
