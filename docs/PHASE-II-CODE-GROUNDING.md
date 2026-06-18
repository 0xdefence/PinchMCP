# Phase II-b — Code Grounding (Design Spec)

Status: **decisions locked, pre-implementation.** This is the design for the
inferred code-coupling layer. Phase II-a (`critical_path`) already shipped.

## Goal

Move beyond Linear's sparse, human-asserted `blocked`/`blocking` relations by
*inferring* coupling between tickets from the code they touch, and surfacing
those as **confirmable suggestions** — never folded into the keystone/critical
-path math. This is the "valuable half": explicit relations are lossy; the code
knows more than the tickets say.

## Locked decisions

| Decision | Choice |
|---|---|
| Repo scope | **Single repo, 1:1 with the Linear project.** No monorepo path-mapping, no cross-repo. |
| Code→code parser | **File-level import graph via a TS/JS-aware grapher** (`dependency-cruiser`/`ts-morph` class). SCIP and tree-sitter (symbol-level / other languages) **deferred**. |
| Hidden coupling | **Git co-change** mined from `git log` — no parser needed. |
| Ticket→code mapping | Via Linear `branchName` + commit/PR messages referencing the issue identifier (`ENG-123`). |
| Inferred edges | **Scored, conservative, evidence-carrying. Surfaced through a separate `suggest_links` tool. Undirected unless import-derived. Never auto-asserted into keystone/CPM.** |
| Direction | Co-change & shared-file are **undirected** ("consider linking"). Only import edges may suggest a direction, cautiously. Co-change never implies a blocker. |

## New input

The relevant tool(s) take a `repo_path` (absolute path to the local git
checkout). The server gains read-only filesystem + `git` access to that path.
No global config; it's a per-call argument so the server stays stateless and one
install can serve different repos.

## Architecture — new `src/code/` layer

```
src/code/
  ticketMap.ts     issue → files it touched (branchName + commit/PR refs → git)
  importGraph.ts   file → file import edges (resolved, directional)
  coChange.ts      file ↔ file co-change weights (git log mining)
  couple.ts        fuse the above → scored ticket↔ticket candidate edges
  git.ts           thin git plumbing (log, show, branch/PR commit lookup)
```

Plus `src/tools/suggestLinks.ts` and a `suggest_links` registration in
`index.ts`. The existing `linear/`, `graph/`, and analysis tools are untouched —
inferred edges live in their own path and never enter `FeatureGraph`.

## Data flow

```
suggest_links(project_id, repo_path)
  → resolve project_id (existing resolver)
  → cache.getOrBuild(project_id)            // existing Linear graph (for identifiers/branchNames)
  → ticketMap: each issue → set of files    // branchName + commit grep over git history
  → importGraph(repo_path)                  // file → file (directional, resolved)
  → coChange(repo_path)                     // file ↔ file (weighted, undirected)
  → couple(): for each ticket pair, score from shared-files / import / co-change
  → filter by confidence threshold (conservative default)
  → return ranked candidate links + evidence
```

## Confidence model

For a candidate edge between tickets A and B, combine three signals over the
files each ticket touched:

- **Shared file** — A and B both modified file F. (undirected, strong)
- **Import coupling** — a file A touched imports a file B touched. (directional, strong)
- **Co-change** — A's files and B's files co-occur in commits, frequency- and
  recency-weighted. (undirected, medium; correlation only)

Each candidate carries a `score`, a `direction` (`undirected` | `a_depends_on_b`
| `b_depends_on_a`, only ever non-undirected from imports), and an `evidence`
list (the concrete files/commits behind it). Default threshold is conservative
(surface shared-file or strong-import; require co-change above a frequency floor);
the threshold is exposed so it can be dialed.

## Output (suggest_links)

Ranked candidate links, each rendered with its evidence, e.g.:

> **ENG-5 ↔ ENG-9** (score 0.82, undirected) — both modified
> `auth/session.ts`; those files co-changed in 4 of the last 6 commits touching
> either. _Consider linking in Linear._

Plus the explicit note that these are suggestions to confirm. Confirmed links are
written **in Linear via the Linear MCP** — PinchMCP never mutates.

## Separation guarantee (load-bearing)

`rank_keystones` and `critical_path` continue to run on **explicit Linear edges
only**. Inferred edges are never inserted into `FeatureGraph`. If we later want a
"with inferred / without inferred" comparison, it ships as an explicit, tagged
overlay — not silent enrichment.

## Edge cases

| Condition | Behavior |
|---|---|
| `repo_path` not a git repo | Tool error with a clear message. |
| Shallow clone / truncated history | Co-change works on available history; warn that depth is limited. |
| No `branchName` / no matching commits for an issue | That issue maps to no files; excluded from suggestions (reported count). |
| Non-TS/JS files | Skipped by the import grapher (co-change still covers them); noted. |
| Huge history | Bound the `git log` window (e.g. last N commits/months); make it configurable; log what was bounded. |

## Testing strategy

- **Pure functions** (`couple`, `coChange` aggregation, `importGraph` parsing,
  scoring) — unit-tested against fixtures.
- **Git plumbing** (`git.ts`) — tested against a small throwaway repo created in
  a temp dir inside the test (real `git init` + commits), so resolution is
  exercised without network or external state.
- **`suggest_links`** — smoke-tested through a stub code layer + the existing
  Linear `StubSource`.

## Deferred (not this slice)

- SCIP / symbol-level coupling and non-TS/JS languages (tree-sitter).
- Multi-repo / monorepo mapping.
- "With/without inferred" overlay diff on keystone/CPM.
- Cold-start semantic matching (separate roadmap item).
- Auto-writing confirmed links (belongs to the Linear MCP, not PinchMCP).

## Implementable decomposition (for the plan)

1. `git.ts` — log/show/branch-commit plumbing (+ temp-repo tests).
2. `ticketMap.ts` — issue → files via branchName + commit identifier grep.
3. `coChange.ts` — file↔file co-change weights from git log.
4. `importGraph.ts` — resolved file→file import edges (TS/JS).
5. `couple.ts` — scoring + candidate ticket↔ticket edges.
6. `suggestLinks.ts` tool + `suggest_links` registration + docs.
