# PinchMCP Architecture

Technical reference for the implementation through Phase III. For the keystone
algorithm itself, see [KEYSTONE-ALGORITHM.md](./KEYSTONE-ALGORITHM.md); for what's
shipped vs. planned, see [ROADMAP.md](./ROADMAP.md).

## Overview

PinchMCP is a stdio [MCP](https://modelcontextprotocol.io) server. An MCP client
(Claude Code) launches it as a subprocess and calls its nine tools. The server
fetches a Linear project's issues + blocking relations, builds an in-memory
directed graph, and runs deterministic graph algorithms over it. There is no
LLM, no embedding, and no persistence inside the server — it is a pure analysis
tool that returns computed structure plus a plain-language explanation.

```
┌────────────┐   stdio / JSON-RPC    ┌─────────────────────────────────────┐
│ Claude Code│◀─────────────────────▶│ PinchMCP (this process)             │
└────────────┘   tool calls          │                                     │
                                      │  index.ts  (MCP server + tools)     │
                                      │     │                               │
                                      │  cache.ts  (per-project graph)      │
                                      │     │                               │
                                      │  graph/*   (pure analysis)          │
                                      │     ▲                               │
                                      │  linear/*  (data adapter)           │
                                      └─────┼───────────────────────────────┘
                                            │ HTTPS / GraphQL
                                            ▼
                                   api.linear.app/graphql
```

## Request flow

A single `rank_keystones` call traverses every layer:

```
rank_keystones(project_id)
  → index.ts handler
  → GraphCache.getOrBuild(project_id)
      → (cache miss) LinearGraphQLSource.fetchProject(project_id)
          → POST api.linear.app/graphql
          → normalizeProject(raw) → { issues, relations }
      → buildFeatureGraph(issues, relations) → FeatureGraph   (cached)
  → rankKeystones(graph) → KeystoneRanking
  → rankKeystonesTool formats → { text, structured }
  → index.ts wraps text as MCP content → client
```

`build_feature_graph` is the only tool that forces a rebuild
(`GraphCache.rebuild`); `rank_keystones`, `critical_path`, and `explain_blockers`
reuse the cached graph, and `list_projects` bypasses the cache entirely (it calls
the source directly and never builds a graph).

## Layers

### Linear adapter — `src/linear/`

Isolates everything Linear-specific behind a single interface so the graph layer
never sees GraphQL.

| File | Responsibility | Key exports |
|------|----------------|-------------|
| `types.ts` | Normalized domain model | `Issue`, `Relation`, `RelationType` |
| `source.ts` | The data-source contract (swap seam) | `IssueSource`, `ProjectData`, `ProjectSummary` |
| `client.ts` | Linear GraphQL implementation + payload normalization | `LinearGraphQLSource`, `normalizeProject` |

`IssueSource` is a two-method interface:

```ts
interface IssueSource {
  fetchProject(projectId: string): Promise<ProjectData>;   // { issues, relations }
  listProjects(): Promise<ProjectSummary[]>;               // { id, name, slugId }[]
}
```

`LinearGraphQLSource` takes an API key and an injectable `fetchFn` (defaults to
the global `fetch`, overridden in tests). It **pages** through the project's
issues with a cursor — 50 issues per request, `relations(first: 50)` each — to
stay under Linear's 10,000 query-complexity cap (one batched query over a large
project is rejected outright). Each request POSTs to
`https://api.linear.app/graphql` with the key in the `Authorization` header (no
`Bearer` prefix — Linear personal API keys are sent raw); the accumulated nodes
from every page are handed to `normalizeProject` as one combined payload.

`normalizeProject` is exported separately and is pure — it maps the raw GraphQL
shape into `Issue[]` / `Relation[]`, which is what the tests exercise (against a
recorded JSON fixture, no network).

### Graph core — `src/graph/`

Pure, I/O-free functions. This is where the value lives, and it is fully unit
tested against synthetic fixtures.

| File | Responsibility | Key exports |
|------|----------------|-------------|
| `types.ts` | Graph + result data types | `GraphNode`, `Edge`, `FeatureGraph`, `KeystoneEntry`, `KeystoneRanking` |
| `build.ts` | Issues + relations → directed graph | `buildFeatureGraph` |
| `keystone.ts` | Dominator-based leverage ranking | `rankKeystones`, `detectCycle` |
| `criticalPath.ts` | Node-weighted CPM (earliest/latest, slack, critical chain) | `criticalPath` |
| `blockers.ts` | Transitive blocker/unblock walk | `explainBlockers`, `BlockerExplanation` |
| `gaps.ts` | Graph hygiene (cycles, isolated, unestimated/unowned keystones) | `findGaps` |

### Code grounding — `src/code/` (Phase II)

Read-only git + filesystem layer that *infers* coupling from the code tickets
touch. Inferred edges are **never inserted into `FeatureGraph`** — they surface
as confirmable suggestions through `suggest_links`, and keystone/critical-path
analysis are unaffected.

| File | Responsibility | Key exports |
|------|----------------|-------------|
| `git.ts` | Shell `git` for commits, changed files, source listing | `isGitRepo`, `gitLog`, `listSourceFiles` |
| `ticketMap.ts` | Issue → files (identifier/branch + attached PR numbers) | `mapTicketsToFiles` |
| `coChange.ts` | File↔file co-change matrix from history | `buildCoChange` |
| `importGraph.ts` | Resolved intra-repo relative-import edges | `buildImportGraph` |
| `couple.ts` | Score candidate ticket↔ticket couplings | `coupleTickets` |

### Cold-start prediction — `src/scope/` (Phase II-c)

For backlog tickets with no code yet: predict likely code areas by TF-IDF
matching ticket text against a keyword index of the repo. Deterministic, **no
embeddings**; behind a `Matcher` seam. Powers `suggest_scope`; never enters
`FeatureGraph`.

| File | Responsibility | Key exports |
|------|----------------|-------------|
| `tokenize.ts` | Identifier/text tokenizer (camel/snake/kebab, stopwords) | `tokenize` |
| `codeIndex.ts` | Per-file keyword docs + corpus df | `buildCodeIndex` |
| `match.ts` | TF-IDF matcher behind the `Matcher` seam | `KeywordMatcher` |
| `scopeCouple.ts` | Predicted ticket↔ticket coupling | `scopeCouple`, `moduleOf` |
| `groundFeature.ts` | Ground a free-text feature → predicted areas + related tickets | `groundFeature` |

### Cache — `src/cache.ts`

`GraphCache` holds one built `FeatureGraph` per `project_id` in a `Map`. It wraps
an `IssueSource` and is the only thing the tool handlers talk to.

```ts
class GraphCache {
  getOrBuild(projectId): Promise<FeatureGraph>; // cache-first
  rebuild(projectId): Promise<FeatureGraph>;    // force fetch + build, replace
}
```

The cache is process-lifetime and unbounded — fine for slice-1 scope (one
project, tens of tickets). There is no TTL or invalidation beyond an explicit
`build_feature_graph` call.

### Tools + server — `src/tools/`, `src/index.ts`, `src/config.ts`

`src/tools/*` are thin handlers: resolve the graph from the cache (or, for
`list_projects`, call the source directly), call one pure function, and format an
explainable `ToolResult`. No graph logic lives here. The nine tools are
`list_projects`, `build_feature_graph`, `rank_keystones`, `critical_path`,
`explain_blockers`, `suggest_links`, `suggest_scope`, `surface_gaps`, and
`decompose_grounding`.

`suggest_links` delegates to `src/code/` (git-derived coupling), `suggest_scope`
and `decompose_grounding` to `src/scope/` (cold-start prediction and feature
grounding), and `surface_gaps` to `src/graph/gaps.ts` (hygiene). All are
**read-only and never mutate `FeatureGraph`** — their output is scored,
evidence-carrying suggestions for a human to confirm; keystone and critical-path
analysis are unaffected. This is the load-bearing boundary: pinch produces
deterministic structure, the client (Claude Code) generates, and the Linear MCP
performs any writes.

`suggest_scope` delegates to `src/scope/` — a read-only keyword-matching layer
(no embeddings, deterministic) that indexes repo source files (path tokens +
identifiers + comment words) and scores ticket text against them via TF-IDF.
Predicted scope and cross-ticket couplings are planning aids only; they **never
enter `FeatureGraph`** and are never used in keystone or critical-path analysis.

```ts
interface ToolResult {
  text: string;       // human-readable, explainable prose (the product)
  structured: unknown; // machine-readable payload (counts / ranking / explanation)
}
```

`src/index.ts` constructs the dependency chain (`config → LinearGraphQLSource →
GraphCache`), registers the nine tools on an `McpServer` with zod input schemas,
and connects a `StdioServerTransport`. `src/config.ts` reads and validates
`LINEAR_API_KEY`, failing fast at startup if it is missing.

## Core data types

```ts
// Linear domain
type RelationType = "blocks" | "blocked_by" | "related" | "duplicate";
interface Issue   { id; identifier; title; state; estimate: number|null; branchName: string|null }
interface Relation{ type: RelationType; fromIssueId; toIssueId }

// Graph
interface Edge { from; to }  // "from" unblocks "to" (to depends on from)
interface FeatureGraph {
  nodes:        Map<string, GraphNode>;
  edges:        Edge[];
  successors:   Map<string, Set<string>>; // from → {to}
  predecessors: Map<string, Set<string>>; // to → {from}
  relatedMeta:  Map<string, Set<string>>; // undirected related/duplicate
}

// Results
interface KeystoneEntry  { id; identifier; title; leverage; dominates: string[]; reachable }
interface KeystoneRanking{ ranked: KeystoneEntry[]; warnings: string[]; isolated: string[] }
```

## Graph semantics

`buildFeatureGraph` normalizes Linear's relations into one canonical direction
and separates flow edges from metadata:

- **`blocks`** (A blocks B) → directed edge **A → B** ("A unblocks B"; B depends
  on A).
- **`blocked_by`** (A blocked by B) → **B → A** (swapped to the same convention).
- **`related` / `duplicate`** → stored in `relatedMeta` (bidirectional),
  **excluded** from the flow graph used by the algorithms.
- **Out-of-project edges** (pointing at an id not in the issue set) are dropped.
- **Self-edges** (`from === to`) are dropped.
- **Duplicate edges** are de-duplicated. Because Linear reports the same
  dependency from both sides (A `blocks` B *and* B `blocked_by` A), both
  normalize to the same canonical edge and collapse to one.

## Error handling

| Condition | Behavior |
|-----------|----------|
| Missing `LINEAR_API_KEY` | `loadConfig` throws at startup; process exits 1 with a clear message. |
| HTTP non-2xx from Linear | `fetchProject` throws with status + body. |
| GraphQL `errors` in response | `fetchProject` throws with the error payload. |
| Project not found (`data.project` null) | `fetchProject` throws `Project not found: <id>`. |
| Tool handler throws | The MCP SDK wraps it as a tool error (`isError: true`) — surfaced to the client, not a crash. |
| Cycle in blocking graph | `rank_keystones` emits a warning listing cycle members; ranking still returns. |
| Isolated tickets (no relations) | Reported in `isolated`; shown as "Ungrounded" in output, excluded from ranked lines. |
| Empty / no-relation project | "No dependency structure found" warning instead of an empty ranking. |

## Testing strategy

- **Graph functions** — unit tested against hand-built fixtures with
  hand-computed expected results (chain, diamond, bottleneck, cycle, isolated).
  Pure functions → fast and deterministic.
- **Linear adapter** — `normalizeProject` tested against a recorded JSON fixture
  plus inline payloads for resilience paths (unknown relation type, missing
  related issue, state default, de-dup). **No live network in any test.**
- **Cache / tools** — exercised through a `StubSource` test double; one test
  drives a `ThrowingSource` to lock in error propagation.

Run with `npm test` (vitest). The suite is 117 tests across 22 files.

## Design decisions

- **GraphQL directly, behind `IssueSource`.** Slice 1 calls Linear's GraphQL API
  rather than proxying the official Linear MCP — faster and fully in our control.
  The `IssueSource` interface is the seam where an MCP-to-MCP client can later
  slot in without touching the graph layer.
- **Dominators, not reachability.** The keystone metric is dominated-subtree
  size, a strictly stronger signal than descendant count. See the algorithm doc.
- **Pure graph core.** All analysis is I/O-free pure functions, which makes the
  interesting logic trivially testable and keeps side effects at the edges.
- **stdio transport.** The standard way to attach a local server to Claude Code.

## Extension points

The architecture is shaped for the roadmap items:

- **Inferred code-coupling graph.** Add edge sources alongside the Linear
  relations and fuse them in `buildFeatureGraph`. Tag inferred edges as a
  distinct class (the `Edge` type is already separate from `relatedMeta`), keep
  them as suggestions, and the existing dominator/blocker analysis runs
  unchanged over the richer graph.
- **MCP-to-MCP passthrough.** Implement `IssueSource` against the official Linear
  MCP and swap it in `index.ts`. Nothing downstream changes.
- **`critical_path`.** `GraphNode.estimate` is already carried through
  normalization; a weighted CPM pass over the same `FeatureGraph` adds the second
  output (duration) next to keystone (leverage).
- **Richer ticket text** (for GraphRAG-style edge enrichment). Widen the GraphQL
  query and `Issue`/`ProjectData` shapes to carry descriptions/comments; the
  enrichment becomes another edge source feeding `buildFeatureGraph`.
