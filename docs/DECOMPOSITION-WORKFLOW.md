# Decomposition Workflow

How to break a free-text feature description into a set of well-grounded Linear
tickets using pinch, Claude Code, and the Linear MCP together.

---

## Division of labor

| Party | Role |
|-------|------|
| **pinch** (`decompose_grounding`) | Grounds the feature: predicts which code areas it will touch and surfaces existing tickets that are likely related (matched at the **module** level — same area, not necessarily the same exact file). Deterministic; reads only; never writes to Linear. |
| **Claude Code** | Reads pinch's structured output and drafts the proposed tickets — titles, descriptions, suggested blocking relations, and checks against existing tickets to avoid duplication. The NL generation lives here, not inside the server. |
| **Linear MCP** | Creates the tickets you confirm. Pinch never calls the Linear write API. |

This split keeps pinch secret-free and deterministic (its output is the same
every time for the same inputs), keeps LLM/NL work in the client where it
already lives, and ensures every write is a confirm-before-acting action in
Linear's own MCP.

---

## Worked example

### 1. Ground the feature

```
decompose_grounding(
  project_id  = "<your-project-id>",
  repo_path   = "/path/to/repo",
  feature     = "Add OAuth login via GitHub so users can sign in without a password"
)
```

Pinch returns:
- **Predicted code areas** — repo files/modules ranked by TF-IDF match to the
  feature text (e.g. `src/auth/`, `src/api/session.ts`, `src/components/LoginForm.tsx`).
- **Related existing tickets** — current issues whose titles/descriptions overlap
  the same code areas or keyword tokens, so the decomposition does not duplicate
  them.

### 2. Ask Claude Code to draft the tickets

Hand the grounding output to Claude Code with a prompt such as:

> "Using the predicted code areas and related tickets pinch returned, draft a set
> of candidate tickets for 'Add OAuth login via GitHub'. For each ticket include:
> a title, a one-paragraph description, the code areas it covers, and suggested
> blocking links to other tickets in this decomposition or to the related existing
> tickets. Do not create tickets that duplicate any of the related existing
> tickets."

Claude Code synthesizes the grounding into a structured proposal — typically
3–8 tickets depending on feature size — with blocking links already wired.

### 3. Create the tickets via the Linear MCP

Review the proposed tickets, adjust as needed, then create them using the
**Linear MCP** (not pinch). Pinch has no write capability by design.

Example Linear MCP calls:
- `linear_create_issue` for each new ticket.
- `linear_create_issue_relation` to record the blocking links.

### 4. Verify the updated graph

After the tickets land in Linear, re-run pinch to confirm the graph is healthy:

```
build_feature_graph(project_id)   # pull the new issues into the cache
rank_keystones(project_id)        # did a new keystone appear?
surface_gaps(project_id)          # any new cycles, isolated tickets, or stale blockers?
```

If `rank_keystones` surfaces a new top-leverage ticket you didn't expect, it
may be worth splitting or re-scoping it. If `surface_gaps` reports a cycle,
one of the new blocking links is contradictory and should be removed.

---

## Why this split

- **Determinism.** Pinch's output is fully reproducible: same project, same repo,
  same feature text → same grounding. No prompt variability.
- **No secrets in the server.** Pinch never calls an LLM API and therefore never
  needs an OpenAI/Anthropic key. Only `LINEAR_API_KEY` is required.
- **Confirm before acting.** Suggestions (grounded or not) are proposals, not
  commits. The human reviews the draft tickets and decides what to create.
- **Clean boundary.** The client (Claude Code) is already the NL layer; embedding
  a second LLM inside the server would duplicate that capability, add latency and
  cost, and blur the trustworthy, testable contract the tools provide.
- **Linear MCP owns writes.** Using the official Linear MCP for creation means
  auth, rate limits, field validation, and audit trail are all Linear's problem.
  Pinch stays a read-only analysis tool.
