# PinchMCP Security & Trust Model

PinchMCP is a **deterministic, read-only analysis server**. These are the
properties that keep it low-risk, and the principles new work must preserve.

## Read-only — pinch never writes

- **No Linear mutations.** The data interface (`IssueSource`) exposes only
  `fetchProject` and `listProjects`; there is no `issueCreate`/`issueUpdate`/
  delete anywhere in the codebase. Pinch cannot create, edit, assign, or delete
  tickets.
- **No filesystem writes.** Pinch reads (Linear over HTTPS; local git/files for
  `repo_path`) but never writes to disk.
- **Ticket creation/assignment is delegated.** Where a workflow needs a write
  (decompose → create tickets; capacity-aware assignment), pinch produces the
  *recommendation* and the **official Linear MCP** performs the write, on human
  confirmation. This is the load-bearing boundary: **pinch analyzes; clients /
  dedicated MCPs deliver and write.**

## Secrets

- **Exactly one secret today:** `LINEAR_API_KEY`. It is read through a single
  choke point (`src/config.ts`), validated fail-fast (missing → clear error,
  exit 1), and **never logged**. Nothing reads `process.env` outside `config.ts`.
- **Injected, not embedded.** The key is supplied by the MCP client at launch via
  the `.mcp.json` `env` block (or `claude mcp add -e`) — it is never baked into
  the build.
- **Gitignored channels.** `.gitignore` covers `.env`, `.env.*`, and `.mcp.json`,
  so a key cannot be committed. The key never appears in source.
- **Local-only plaintext.** As a local **stdio** server the key lives in plaintext
  in `.mcp.json`/`.env`, protected by filesystem permissions. The secret never
  leaves the machine.

## Adding integrations — keep secrets with each integration's MCP

When connecting Slack, Granola, or other systems (Phase IV):

- **Pinch should hold zero new secrets.** Each integration's credential stays with
  the MCP that owns that integration — the Slack MCP holds the Slack token, a
  Granola source holds Granola creds, the Linear MCP holds write auth. Pinch only
  produces the analysis they act on.
- Adding a Slack/Granola key *to pinch* would expand its secret surface for no
  reason and break the "pinch only analyzes" boundary. Don't.
- **Target: zero secrets in pinch.** The roadmap's MCP-to-MCP passthrough
  (implement `IssueSource` against the Linear MCP, which already holds your Linear
  auth) would let pinch drop even `LINEAR_API_KEY`.

If a new secret is ever genuinely required, add it the same way: validated in
`config.ts`, fail-fast, never logged, value in the gitignored `.mcp.json`/`.env`.

## Network & `repo_path` safety

- Pinch's only network egress is `https://api.linear.app/graphql`.
- `repo_path` is an arbitrary local path the caller supplies; pinch runs `git`
  via `execFile` with **array args (no shell)** — no command injection — and reads
  source files under it. Import resolution is confined to within the repo
  (`..`-escape rejected). The residual exposure (an arbitrary path gets git-logged
  and its TS/JS files read) is inherent to the feature and read-only.

## Not in scope (and when it would matter)

- **No vault / secret manager.** Fine for a local stdio server. If pinch ever
  becomes a **remote/hosted** server, this changes: you would need real secret
  storage, per-user auth, transport security, and tenant isolation — a separate
  design effort, not a config tweak.
- **No audit log.** Pinch is stateless and read-only, so there is nothing to
  audit on its side; writes (and their audit trail) live in Linear.

## One-line summary

Pinch reads Linear and your repo, computes structure, and hands back
suggestions. It holds one local secret, logs none of it, writes nothing, and
delegates every write to the system that owns it.
