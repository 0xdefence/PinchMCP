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

## Phase II — Code grounding 🟡 (the valuable half)

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

- ⬜ Ticket → code mapping — via `branchName` + commit/PR references to issue ids
- ⬜ Code → code dependency — resolved file-level import graph (TS/JS first)
- ⬜ Git **co-change** matrix — hidden coupling from files that change together
- ⬜ `suggest_links` tool — scored candidate ticket↔ticket edges with evidence
- ⬜ Cold-start semantic matching — match ticket text against the symbol index so
  future tickets with no code yet still place in the graph
- ⬜ GraphRAG-style edge enrichment — LLM-extract implicit dependencies from
  ticket descriptions / comments / PR text (suggestions only)
- ⬜ MCP-to-MCP passthrough — implement `IssueSource` against the official Linear
  MCP and swap it in (seam already in place)
- ⬜ Whole-org scope — beyond one project (10–40 tickets) to cross-project/org

## Phase III — Generative (scope out work) ⬜

New capability class: produce work items, not just analyze them. Grounded on
Phase II's coupling graph; generation done by the client using the server's
structured output.

- ⬜ Feature → ticket decomposition — break a feature description into candidate
  tickets *with* suggested blocking relations, so the graph exists before
  anyone hand-links it
- ⬜ Improvement / gap surfacing — mine the graph for problems: orphan tickets,
  suspected-but-unlinked blockers, cycles to resolve, keystones missing
  owner/estimate
- ⬜ Grounded suggestions — "these three tickets all touch the auth module but
  aren't linked — should they be?" (needs the Phase II code-coupling graph)

## Smaller open items ⬜

- ⬜ `explain_blockers` cycle annotation (`rank_keystones` already warns)
- ⬜ Relation pagination beyond 50 per issue (issues with >50 blocking relations
  currently miss the overflow — implausible in practice)

---

_Phase I is complete. Phase II has started with `critical_path` (II-a); the
code-grounding subsystem (II-b) and Phase III are not started._
