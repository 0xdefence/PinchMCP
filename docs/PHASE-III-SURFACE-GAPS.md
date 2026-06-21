# Phase III (start) — surface_gaps (Design Spec)

Status: **decisions locked, pre-implementation.**

## Boundary (the load-bearing principle)

Phase III is "generative," but **pinch stays a deterministic analysis server** —
it never calls an LLM, never writes to Linear, never generates ticket text. The
generative split:

- **pinch** → produces the structured substrate (gaps, grounding, graph fit).
- **Claude Code** → generates the proposed tickets/links (the NL part).
- **Linear MCP** → performs the writes.

`surface_gaps` is squarely on pinch's side: deterministic graph/coupling hygiene
that *feeds* a planner, asserting nothing and writing nothing.

## What it does

`surface_gaps(project_id)` mines the dependency graph for actionable hygiene
problems and returns them as a report. Four categories (v1), all deterministic:

| Gap | Definition | Why it matters |
|---|---|---|
| **Cycles** | Members of any dependency cycle in the blocking graph | A cycle can't be scheduled; must be broken |
| **Isolated tickets** | Tickets with no blocking relations at all | No recorded dependencies — intentional, or links missing? Prompts `suggest_scope`/`suggest_links` |
| **Unestimated keystones** | Tickets with leverage > 0 (gatekeep ≥1 ticket) and no estimate | Can't compute the critical path through them |
| **Unowned keystones** | Tickets with leverage > 0 and no assignee | High-leverage work nobody owns |

It composes existing deterministic analysis: `rankKeystones` for leverage +
isolated set, the existing cycle detection, and node fields (estimate, assignee).

## New input — Linear `assignee`

For "unowned keystones" we need the assignee. Add `assignee { name }` to the
issues query; `Issue` and `GraphNode` gain `assignee?: string | null`, threaded
exactly like `description`/`prNumbers` (default `null`). Negligible query
complexity (one nested scalar per issue).

## Architecture

```
src/graph/gaps.ts        findGaps(graph): GapReport — pure; composes rankKeystones + detectCycle
src/graph/keystone.ts    export detectCycle (already implemented privately) for reuse
src/linear/*             Issue/GraphNode gain assignee?: string|null (fetched + threaded)
src/tools/surfaceGaps.ts surfaceGapsTool(cache, projectId)
src/index.ts             register surface_gaps
```

## Data shape

```ts
interface GapReport {
  cycles: string[];               // identifiers in a cycle
  isolated: string[];             // identifiers with no relations
  unestimatedKeystones: string[]; // identifiers (leverage>0, no estimate)
  unownedKeystones: string[];     // identifiers (leverage>0, no assignee)
  summary: string;                // one-line count roll-up
}
```

## Output (surface_gaps)

```
Graph hygiene for <project>: 1 cycle, 12 isolated, 2 unestimated keystones, 1 unowned keystone.

Cycles (must break to schedule): ELI-5 ↔ ELI-9
Unestimated keystones (block critical-path planning): ELI-22, ELI-20
Unowned keystones (high leverage, no assignee): ELI-22
Isolated (no recorded dependencies — try suggest_scope/suggest_links): ELI-23, ELI-25, … (12)
```

Each section omitted when empty; a fully-clean project says "No gaps found."

## Edge cases

| Condition | Behavior |
|---|---|
| No issues | "No issues in project." |
| No gaps | "No gaps found — graph is clean." |
| All isolated (sparse backlog) | Lists them, framed as a prompt to run `suggest_scope`/`suggest_links`, not an error |
| Large isolated set | Truncate the printed list with a "… (N total)" tail; full set in `structured` |

## Testing

- `findGaps` (synthetic graphs) — cycle members; isolated set; unestimated keystone (leverage>0 + null estimate); unowned keystone (leverage>0 + null assignee); clean graph → empty report.
- `normalizeProject` — `assignee` extracted from `assignee.name`; null when absent.
- `buildFeatureGraph` — `assignee` threaded onto the node.
- `surface_gaps` tool (stub source) — renders the categories; clean project → "No gaps found."

## Out of scope (this iteration / Phase III roadmap)

- **Stale blockers** (a ticket blocked by a Done/Cancelled ticket) — strong v2 gap; needs `state.type`. Deferred.
- **Inferred-but-unlinked coupling** as a gap category — already surfaced by `suggest_links`/`suggest_scope`; not duplicated here.
- `decompose_grounding` tool and the generative decomposition workflow — later Phase III pieces; pinch provides grounding, the client generates, Linear MCP writes.
