# PinchMCP Roadmap

Status of what's built versus planned. ✅ done · 🟡 partial · ⬜ not started.

## Design principle: where NLP lives

PinchMCP is a **deterministic analysis server**, not an LLM. The natural-language
understanding already happens in the MCP **client** (Claude Code): it parses what
the user means and decides which tool to call with which arguments. We
deliberately do **not** build a second NLP/LLM engine inside the server — that
would be redundant with the client, add latency and cost, and erode the
trustworthy, testable contract the tools provide.

What we *do* provide is **fuzzy, forgiving inputs** so the experience feels
natural: tools accept project names / URL slugs / UUIDs interchangeably and
resolve them internally. The generative roadmap (Phase III) follows the same
split — the client generates, grounded on the server's structured analysis.

---

## Phase I — Explicit-graph slice ✅ (shipped)

The keystone idea proven end-to-end on Linear's explicit `blocked`/`blocking`
relations.

- ✅ stdio MCP server scaffold (TypeScript, vitest)
- ✅ Linear GraphQL data layer behind the `IssueSource` swap seam
- ✅ `build_feature_graph` — fetch + normalize + build the directed graph
- ✅ `rank_keystones` — dominator-tree leverage ranking (Cooper–Harvey–Kennedy),
  distinct from reachability, with plain-language explanations
- ✅ `explain_blockers` — transitive upstream/downstream chain walk
- ✅ Per-`project_id` graph cache
- ✅ `list_projects` — enumerate workspace projects (id / name / slug)
- ✅ **Fuzzy project resolution** — `project_id` accepts a name, URL slug, or UUID
- ✅ Cursor pagination of the Linear fetch (stays under the 10k complexity cap)
- ✅ Hardening — dependency/security updates, Node 22+, `noEmitOnError`, docs

## Phase II — Code grounding ✅ (the valuable half)

Move beyond human-asserted Linear links to *inferred* coupling, and add the
duration view. Direction inference is the weak link, so inferred edges ship as
**suggestions to confirm**, never auto-asserted.

- ✅ `critical_path` tool — node-weighted CPM over estimates ("what sets total
  duration"), surfaced alongside keystone ("max leverage unlock"). Full CPM:
  earliest/latest start, slack per ticket, zero-slack critical chain;
  unestimated tickets default to duration 1 (reported)
**II-b — inferred code coupling** (design locked, see
[`PHASE-II-CODE-GROUNDING.md`](./PHASE-II-CODE-GROUNDING.md)). Decisions: single
repo 1:1 with the project; file-level import graph via a TS/JS grapher + git
co-change (SCIP/tree-sitter deferred); inferred edges surface through a separate
`suggest_links` tool, scored and evidence-carrying, undirected unless
import-derived, **never folded into keystone/CPM**.

- ✅ Ticket → code mapping — identifier/branch commit refs **plus Linear attachment PR numbers** (`(#N)` squash-merge match)
- ✅ Code → code dependency — resolved intra-repo relative-import graph (TS/JS)
- ✅ Git **co-change** matrix — hidden coupling from files that change together
- ✅ `suggest_links` tool — scored candidate ticket↔ticket edges with evidence
- ✅ Cold-start semantic matching — keyword/TF-IDF index of repo source files;
  `suggest_scope` tool predicts code areas per ticket and surfaces likely
  cross-ticket couplings, for backlog tickets with no code yet
- ⬜ GraphRAG-style edge enrichment — LLM-extract implicit dependencies from
  ticket descriptions / comments / PR text (suggestions only)
- ⬜ MCP-to-MCP passthrough — implement `IssueSource` against the official Linear
  MCP and swap it in (seam already in place)
- ⬜ Whole-org scope — beyond one project (10–40 tickets) to cross-project/org

## Phase III — Generative (scope out work) 🟡

New capability class: produce work items, not just analyze them. Grounded on
Phase II's coupling graph; generation done by the client using the server's
structured output.

- 🟡 Feature → ticket decomposition — `decompose_grounding` ships the server
  side: predicted code areas + related tickets for a free-text feature. The
  decomposition workflow (grounding → Claude Code drafts tickets → Linear MCP
  creates them) is documented in
  [`docs/DECOMPOSITION-WORKFLOW.md`](./DECOMPOSITION-WORKFLOW.md). Generation
  itself is client-side by design; pinch never creates tickets.
- ✅ Improvement / gap surfacing — `surface_gaps` tool: mine the graph for
  problems: orphan tickets, cycles to resolve, stale blockers (blocker already
  done), keystones missing owner/estimate. Deterministic; asserts/writes nothing.
- ✅ Grounded suggestions — `decompose_grounding` grounds free-text features
  against the code-coupling index; surfaces tickets that overlap the same
  code **module** (not just the exact file) so decomposition does not duplicate
  existing work.

## Phase IV — Integrations (planned, needs its own spec)

Connect PinchMCP's analysis to where the team works. Preserves the deterministic
boundary: **pinch analyzes (assignment recommendations, reconciliation); clients
/ dedicated MCPs deliver, ingest, and write.**

- ⬜ **Capacity-aware assignment / sprint planning** (Slack-surfaced) — recommend
  who works on what: among *ready* tickets (blockers done), prioritize by keystone
  leverage + critical-path membership, then assign respecting each person's
  **capacity** and current load, matching expertise via `suggest_scope` / code
  ownership. Feeds sprint/goal planning and incoming bugs/feedback/user requests.
  The recommendation is pinch's (deterministic, composing keystone + critical_path
  + readiness + scope); a **Slack MCP** is the delivery + human-confirm surface;
  the **Linear MCP** writes the assignments.
  *Open question — capacity data source:* Linear doesn't track bandwidth; supplied
  per-call, or partly derived from in-progress load per assignee.
- ⬜ **Meeting-notes reconciliation** (Granola-fed) — ingest notes from meetings /
  user calls / standups / syncs; the client/LLM **extracts** mentioned bugs, ticket
  refs, feature requests, and blockers; pinch then **reconciles the structured
  result against the Linear graph** — blockers mentioned but not recorded (a gap),
  features overlapping existing tickets (`decompose_grounding`), refs that resolve.
  Sibling to `surface_gaps`. Extraction stays client-side (keeps pinch
  deterministic); inferred items are suggestions to confirm; the Linear MCP writes.

Each needs its own brainstorm → spec before building. The assignment recommender
is the natural first deterministic deliverable; both depend on the capacity-data
and extraction-boundary decisions above.

## Smaller open items

- ✅ `explain_blockers` cycle annotation — cycles now annotated in blocker output
- ⬜ Relation pagination beyond 50 per issue (issues with >50 blocking relations
  currently miss the overflow — implausible in practice)

---

_Phase I and Phase II are complete. Phase III is nearly complete: `surface_gaps`
(gap surfacing with stale-blocker detection) and `decompose_grounding` (feature
grounding + decomposition workflow) are shipped. Remaining deferred items:
whole-org scope, MCP-to-MCP passthrough, and embedding backend. **Phase IV
(integrations) is planned: Slack and Granola — each to be scoped.**_
