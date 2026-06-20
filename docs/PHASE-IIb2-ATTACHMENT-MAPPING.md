# Phase II-b.2 — Attachment-based ticket→code mapping (Design Spec)

Status: **decisions locked from the live finding, pre-implementation.**

## Why

The live `suggest_links` run on the real 0xDefend repo returned nothing: of 231
commits, only ~5 cite a Linear `ELI-` identifier, so 18 of 20 tickets mapped to
no files. The ticket→code mapping leans entirely on developers citing the Linear
ID in commit messages — a convention this team (and most) doesn't follow.

**Fix:** stop depending on commit hygiene. Linear's GitHub integration already
records which **PR** belongs to each issue (as an *attachment*). Map
issue → attached PR → files, and union it with the existing ID/branch mapping.
This is purely additive — it widens ticket→code coverage; nothing else changes.

## Evidence (verified on the real repo)

- 0xDefend squash-merges with the PR number in the subject: `… (#44)`,
  distinct PRs `#33`–`#44` present in history. So **PR number → commit → files**
  works with git alone — no GitHub API/auth needed.
- The tickets that *did* map last run (ELI-36/39/40) are exactly the ones whose
  work landed in ID-citing commits; the attachment path will recover the rest.

## Locked decisions

| Decision | Choice |
|---|---|
| PR → files mechanism | **git** — grep merge/squash commit subjects for `(#N)` (fixed-string), union their files. No `gh`/GitHub API dependency. |
| Relationship to existing mapping | **Augment** (union), not replace. `mapTicketsToFiles` keeps ID + branchName matching and adds PR-number matching. |
| PR source | Linear issue **attachments** (the GitHub integration link), parsed for `/pull/<N>`. |
| Branch refs | Deferred — PR attachments cover the merged case; raw branch matching is a later refinement. |

## Changes

1. **Linear layer** (`src/linear/`):
   - Extend the issues query with `attachments(first: 25) { nodes { url } }`
     (per-page complexity stays well under the 10k cap: ~+1k/page at 50 issues).
   - `Issue` gains `prNumbers: number[]` — `normalizeProject` extracts them from
     attachment urls matching `github.com/.+/pull/(\d+)` (deduped, numeric).
2. **Graph layer** (`src/graph/`):
   - `GraphNode` gains `prNumbers: number[]`; `buildFeatureGraph` threads it
     through (exactly like `branchName`).
3. **Code layer** (`src/code/`):
   - `IssueRef` gains `prNumbers: number[]`.
   - `mapTicketsToFiles` adds, per issue, a fixed-string match for `(#<N>)` in
     commit subjects for each of the issue's PR numbers — unioning those commits'
     files with the ID/branch matches.
4. **Tool** (`src/tools/suggestLinks.ts`):
   - Build `IssueRef` with `prNumbers` from `graph.nodes`. No other logic change.

## Data shape

```ts
// linear/types.ts
interface Issue { …; branchName: string | null; prNumbers: number[] }
// graph/types.ts
interface GraphNode { …; branchName: string | null; prNumbers: number[] }
// code/ticketMap.ts
interface IssueRef { id; identifier; branchName: string | null; prNumbers: number[] }
```

## The one assumption to confirm

The exact Linear **attachment** GraphQL shape. Design targets the documented
`issue.attachments.nodes[].url` (the GitHub integration stores the PR URL there).
**First build step verifies this against the real API** — either by dropping the
key in `.env` and inspecting ELI-36's attachments, or via a recorded fixture —
before the normalization code is written. If the field differs (e.g. PR lives in
`attachment.metadata` not `url`), the extractor adjusts; nothing else moves.

## Edge cases

| Condition | Behavior |
|---|---|
| Issue has no attachments | `prNumbers: []`; falls back to ID/branch mapping (current behavior). |
| Attachment is not a GitHub PR (Slack, Figma, …) | url doesn't match `/pull/N`; ignored. |
| PR not squash-merged / no `(#N)` in history | That PR contributes no files; ID/branch mapping still applies. Documented limitation. |
| PR number collides across repos | Low risk (single repo, 1:1); `(#N)` is repo-local in practice. |

## Testing

- `normalizeProject` — recorded fixture with a GitHub PR attachment → `prNumbers` extracted; non-PR attachment ignored; missing attachments → `[]`.
- `mapTicketsToFiles` — a commit subject `…(#44)` + an issue with `prNumbers:[44]` → that commit's files mapped, even with no identifier in the message.
- `buildFeatureGraph` — `prNumbers` threaded onto `GraphNode`.
- End-to-end `suggest_links` (temp repo) — two tickets whose only link is via PR-number commits get coupled.

## Out of scope (this iteration)

- GitHub API (`gh`) PR→files (only needed for non-squash/open PRs).
- Raw branch-ref matching beyond branchName-in-message.
- Cold-start semantic matching for genuinely codeless tickets (separate roadmap item — covers the Tier-3 backlog the attachment path can't, because there's no code yet).
