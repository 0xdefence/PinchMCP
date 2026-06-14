# PinchMCP — Explicit-Graph Path (Slice 1) Design

**Date:** 2026-06-14
**Status:** Approved design, pre-implementation
**Scope:** First build step only — prove the explicit dependency-graph path end-to-end before any code grounding.

## 1. Goal

Stand up an MCP server that pulls a Linear project's issues and their blocking
relations, builds an in-memory dependency graph, and identifies the **keystone**
ticket via dominator analysis — the ticket that every downstream path must pass
through. Explainability is the product: outputs say *why* a ticket is keystone,
not just a score.

This slice deliberately excludes the code-coupling graph, co-change history,
semantic matching, and critical-path/CPM. Those land in later slices.

## 2. Decisions Locked

| Decision | Choice | Notes |
|---|---|---|
| Runtime | TypeScript / Node | Best MCP SDK support; tree-sitter Node bindings available for later slices. |
| Linear data source | Linear GraphQL API directly | Diverges from the brief's literal "wrap the Linear MCP" framing for speed and control. Hidden behind an `IssueSource` interface so an MCP-to-MCP client can slot in later. |
| Slice 1 tool surface | `build_feature_graph`, `rank_keystones`, `explain_blockers` | `critical_path` deferred until estimates + CPM are wired (estimates are often sparse). |
| Keystone algorithm | Dominator tree (approach A) | Subtree size = leverage. Distinct from descendant-count centrality, which counts redundant paths. |
| Transport | stdio | Standard for local Claude Code. |
| Version control | Standalone git repo inside `PinchMCP/` | Isolated from the shared GitHub-folder repo. |

## 3. Architecture

stdio MCP server. Three layers, each independently testable:

```
src/
  index.ts            MCP server entry: stdio transport, tool registration
  linear/
    types.ts          Normalized domain types: Issue, Relation, RelationType
    client.ts         GraphQL adapter implementing IssueSource
    source.ts         IssueSource interface (the swap seam for MCP-to-MCP later)
  graph/
    types.ts          FeatureGraph, node/edge shapes, analysis result types
    build.ts          Fuse issues + relations -> directed FeatureGraph
    keystone.ts       Dominator-tree computation -> keystone ranking
    blockers.ts       Upstream/downstream chain walk for explain_blockers
  tools/
    buildFeatureGraph.ts
    rankKeystones.ts
    explainBlockers.ts
  cache.ts            Per-project_id built-graph cache
  config.ts           Env loading (LINEAR_API_KEY), validation
```

### Module contracts

- **`IssueSource`** — `getProjectIssues(projectId): Promise<Issue[]>`,
  `getRelations(projectId): Promise<Relation[]>`. Depends on: Linear API + key.
  Consumers never see GraphQL; they see normalized domain types.
- **`build.ts`** — pure function `buildFeatureGraph(issues, relations): FeatureGraph`.
  No I/O. Depends only on domain types.
- **`keystone.ts`** — pure function over `FeatureGraph`. No I/O.
- **`blockers.ts`** — pure function over `FeatureGraph`. No I/O.
- **`tools/*`** — thin: resolve cache, call a pure graph function, format
  explainable output. No graph logic lives here.

## 4. Data Flow

```
Claude Code -> tool call (project_id)
            -> cache.getOrBuild(project_id)
                 -> IssueSource.getProjectIssues + getRelations
                 -> buildFeatureGraph(issues, relations)
            -> analysis fn (keystone | blockers)
            -> format: prose explanation + structured data
            -> MCP response
```

The graph is cached per `project_id`. `build_feature_graph` forces a (re)build;
the other tools reuse the cache.

## 5. Graph Semantics

- **Nodes** = Linear issues in the project. Carry id, identifier (e.g. `ENG-123`),
  title, state, estimate (stored, unused this slice), branchName (stored, unused).
- **Edges** — Linear relation types normalized to one canonical direction:
  - `blocks` (A blocks B) and `blocked by` (B blocked by A) both become a directed
    edge **A → B**, read as "A unblocks B" / "B depends on A".
  - `related` / `duplicate` are retained as node metadata only; **excluded** from
    the dominator flow graph.
- Duplicate/inverse relation pairs are de-duplicated to a single canonical edge.

## 6. Keystone Algorithm (Dominator Analysis)

1. Build the directed flow graph from `blocks` edges (A → B).
2. Detect cycles. A pure dominator tree assumes a flowgraph; cycles are reported
   as warnings (they indicate a dependency problem) and the algorithm proceeds on
   the graph as given (standard dominator algorithms tolerate back-edges).
3. Add a virtual `ENTRY` node with edges to every **source** node (in-degree 0 in
   the blocking graph — tickets with no blockers, i.e. ready to start).
4. Compute the dominator tree rooted at `ENTRY` (iterative Cooper-Harvey-Kennedy
   "A Simple, Fast Dominance Algorithm", ~60 LOC, no external dep).
5. For each real node, **leverage = size of its dominated subtree** (count of
   nodes it strictly dominates). This is the count of downstream tickets that
   *cannot* proceed until it is done — the keystone metric.
6. Rank descending. Ties broken by raw descendant-reachability count.

### Explanation
For each ranked ticket: list the dominated tickets and render
"every path to {X, Y, Z} passes through this ticket." This prose is generated
directly from the dom-tree structure — explanation is free, not bolted on.

### Edge cases reported, not hidden
- **Cycles** → warning listing the cycle members.
- **Isolated nodes** (no relations at all) → listed as "ungrounded; no
  dependency signal."
- **Empty project / no relations** → explicit "no dependency structure found"
  rather than an empty ranking.

## 7. explain_blockers(ticket_id)

Walk the graph from the target ticket:
- **Upstream** — transitive set of tickets that block it (must finish first).
- **Downstream** — transitive set it unblocks.

Return both chains plus a one-line summary
("Blocked by N tickets through M hops; unblocks K tickets"). The downstream count
is the same leverage signal `rank_keystones` uses, surfaced for a single ticket.

## 8. Error Handling

| Condition | Behavior |
|---|---|
| Missing `LINEAR_API_KEY` | Fail fast at startup with a clear message. |
| Project not found | Tool returns a structured error, not an exception. |
| Empty project | "No issues found for project" — not an empty graph. |
| No relations | Graph builds; analysis reports "no dependency structure." |
| Cycle in blocking graph | Warning in output; analysis still runs. |
| Linear API error / timeout | Surfaced as a tool error with the upstream message. |

## 9. Testing

- **Graph functions** (`build`, `keystone`, `blockers`) — unit tests against
  synthetic fixtures: hand-built graphs with hand-computed dominator trees
  (linear chain, diamond, fan-out, cycle, disconnected). These are pure functions,
  so tests are fast and deterministic.
- **Linear adapter** — tested against a recorded JSON fixture of a GraphQL
  response; **no live API calls** in tests. Validates normalization
  (relation direction, de-dup, metadata retention).
- **Tools** — smoke tests wiring a stub `IssueSource` through to formatted output.

## 10. Out of Scope (Later Slices)

- Code-coupling graph (tree-sitter/SCIP import edges, git co-change matrix).
- Ticket→code mapping via branchName / commit / PR references.
- Semantic matching for cold-start tickets with no code.
- `critical_path` (weighted CPM over estimates).
- MCP-to-MCP passthrough to mcp.linear.app (interface seam is in place).
- Whole-org scope (slice 1 targets one project, 10–40 tickets).
