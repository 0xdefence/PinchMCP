# PinchMCP

An MCP server that finds the **keystone** ticket in a Linear feature — the one
that, once done, unblocks the most downstream work — via **dominator analysis**
of the dependency graph. It sits between Claude Code and Linear: it reads a
project's issues and their blocking relations, fuses them into an in-memory
graph, and tells you where the leverage is.

> **Status.** Phase I (explicit dependency graph) and Phase II (code grounding)
> are shipped; Phase III (generative scoping) is nearly complete. Nine tools across the
> explicit graph, inferred code coupling, cold-start prediction, graph hygiene, and
> feature decomposition grounding — all deterministic, no LLM in the server. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's done vs. planned.

---

## Running locally (quickstart)

**There is nothing to deploy.** PinchMCP is a [stdio](https://modelcontextprotocol.io/docs/concepts/transports)
MCP server: Claude Code launches it as a local subprocess on demand and talks to
it over stdin/stdout. "Running it" just means the built code lives on the machine
where you run Claude Code — no port, no daemon, no hosting. Each developer who
wants it does this once on their own machine, with their own Linear key.

End to end:

```bash
# 1. Get the code and build it (needs Node 22+)
git clone https://github.com/0xdefence/PinchMCP.git
cd PinchMCP
npm install
npm run build
```

```bash
# 2. Get a Linear personal API key
#    Linear → Settings → Security & access → Personal API keys → Create key
#    (copy the lin_api_… value)

# 3. Find the project_id you want to analyze
curl -s https://api.linear.app/graphql \
  -H "Authorization: lin_api_your_key" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ projects(first: 50) { nodes { id name } } }"}'
```

```jsonc
// 4. Register the server with Claude Code.
//    Create .mcp.json in your project root (or ~/), using the ABSOLUTE path
//    to dist/src/index.js printed by `pwd`:
{
  "mcpServers": {
    "pinch-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/PinchMCP/dist/src/index.js"],
      "env": { "LINEAR_API_KEY": "lin_api_your_key" }
    }
  }
}
```

```text
5. Restart Claude Code, run /mcp to confirm "pinch-mcp" is connected,
   then ask: "Rank the keystones for Linear project <project_id>."
```

Each step is expanded in the sections below
([Install](#install) · [API key](#get-a-linear-api-key) ·
[project_id](#find-your-project_id) ·
[Connect to Claude Code](#connect-it-to-claude-code) · [Use it](#use-it)).

---

## What it does

Questions teams actually ask, with distinct answers:

- **Keystone** — *"What single ticket, once done, unblocks the most downstream
  work?"* Answered by **dominator analysis**: a ticket is high-leverage when
  every path to many downstream tickets must pass through it. This is *not* the
  same as "the ticket that touches the most things" — a bottleneck that
  gatekeeps 5 tickets beats a ticket that merely precedes 20 reachable ones.
- **Critical path** — *"What sets the total timeline?"* Answered by **CPM** over
  estimates: the longest-duration dependency chain, plus how much slack every
  other ticket has. Distinct from keystone — max-leverage unlock vs. what sets
  duration.
- **Blockers** — *"For this one ticket, what must finish first, and what does it
  unblock?"* Answered by a transitive walk up and down the dependency chain.

**Explainability is the product.** Output says *why*: "every path to ENG-2,
ENG-3 passes through ENG-1," not a bare score.

### Tools exposed to Claude Code

| Tool | Input | What it returns |
|------|-------|-----------------|
| `list_projects` | _(none)_ | Lists the workspace's projects with their ids and URL slugs, so you can pick a `project_id`. Linear's lookup needs a UUID or slug, not a display name. |
| `build_feature_graph` | `project_id` | Fetches issues + relations and (re)builds the cached graph. Reports issue/edge counts. |
| `rank_keystones` | `project_id` | Tickets ranked by leverage (dominated-subtree size), with plain-language explanations, plus warnings (cycles) and ungrounded tickets. |
| `critical_path` | `project_id` | CPM over estimates: the longest-duration chain that sets the timeline, plus per-ticket slack. Answers "what sets total duration" (vs keystones' "max leverage unlock"). Unestimated tickets default to 1. |
| `explain_blockers` | `project_id`, `ticket_id` | Transitive blockers (must finish first) and downstream unblocks for one ticket. `ticket_id` accepts a Linear UUID or a human identifier like `ENG-12`. |
| `suggest_links` | `project_id`, `repo_path` | Infers coupling from code (shared files, intra-repo imports, git co-change) and suggests ticket links Linear doesn't record — evidence-backed, confirm-before-acting. Never folded into keystone/critical_path. |
| `suggest_scope` | `project_id`, `repo_path` | **Cold-start**: predicts which code areas a ticket will likely touch and which tickets likely couple, from ticket text vs a keyword index of the repo — for backlog tickets with no code yet. Planning aid; never used in keystone/critical_path. |
| `surface_gaps` | `project_id` | Reports graph hygiene gaps — cycles, isolated tickets, stale blockers (blocker already done), and keystones missing an estimate or owner. Deterministic; asserts/writes nothing. |
| `decompose_grounding` | `project_id`, `repo_path`, `feature` | Cold-start grounding for a free-text feature: predicted code areas + related existing tickets, for the client to decompose. Never creates tickets. |

Across the analysis tools, **`project_id` accepts a Linear project name,
URL slug, or UUID** — it's resolved internally, so you can speak in names
(*"rank keystones for 0xDefence"*) and PinchMCP maps it to the right project.

---

## Requirements

- **Node.js 22 or newer** (active LTS; Node 18 is end-of-life). The server uses
  the global `fetch`.
- A **Linear account** and a **personal API key**.
- **Claude Code** (or any MCP client that can launch a stdio server).

---

## Install

```bash
git clone https://github.com/0xdefence/PinchMCP.git
cd PinchMCP
npm install
npm run build
```

`npm run build` compiles TypeScript to `dist/`. The server entrypoint is
`dist/src/index.js`.

Verify it built and starts (it should wait for stdio input, then exit cleanly on EOF):

```bash
LINEAR_API_KEY=dummy node dist/src/index.js < /dev/null && echo "starts OK"
```

With no key it should fail fast with a clear message:

```bash
node dist/src/index.js < /dev/null   # -> Error: LINEAR_API_KEY environment variable is required.
```

---

## Get a Linear API key

1. Linear → **Settings** → **Security & access** → **Personal API keys**.
2. **Create key**, give it a name, copy the value (looks like `lin_api_…`).

The key is passed to the server as the `LINEAR_API_KEY` environment variable.
For local CLI use you can also copy `.env.example` to `.env` and set it there.

> **Never commit your key.** `.env` is gitignored. The key grants access to your
> Linear workspace.

---

## Find your `project_id`

The analysis tools take a Linear **project UUID** or the **URL slug** — *not* a
display name (Linear's `project(id:)` lookup rejects names). Three ways to get a
valid value:

1. **Ask Claude Code** once the server is connected: *"list my Linear projects"*
   runs the `list_projects` tool and prints every project with its id and slug.
2. **From the project URL** — `linear.app/<workspace>/project/<name>-<slugId>`.
   Paste the whole `<name>-<slugId>` slug or just the trailing hex; both work.
3. **Via curl**:

```bash
curl -s https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ projects(first: 50) { nodes { id name slugId } } }"}' | jq
```

Any `id` or `slugId` from the output works as `project_id`.

---

## Connect it to Claude Code

PinchMCP is a **stdio** MCP server. Point Claude Code at the built entrypoint
with your API key in the environment.

### Option A — project config file (recommended)

Create `.mcp.json` in the root of the repo where you want to use it (or your home
directory for global use):

```json
{
  "mcpServers": {
    "pinch-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/PinchMCP/dist/src/index.js"],
      "env": { "LINEAR_API_KEY": "lin_api_your_key_here" }
    }
  }
}
```

Use the **absolute** path to `dist/src/index.js`. Restart Claude Code (or
reconnect MCP servers) so it picks up the config.

### Option B — Claude Code CLI

```bash
claude mcp add pinch-mcp \
  -e LINEAR_API_KEY=lin_api_your_key_here \
  -- node /absolute/path/to/PinchMCP/dist/src/index.js
```

### Verify the connection

In Claude Code, run `/mcp` — you should see `pinch-mcp` connected with three
tools. If it shows as failed, check: the path is absolute and points at
`dist/src/index.js`, you ran `npm run build`, and `LINEAR_API_KEY` is set.

---

## Use it

Once connected, just ask Claude Code in natural language — it will call the
tools. Examples:

- *"Build the feature graph for project `<project_id>` and rank the keystones."*
- *"Which ticket is the biggest bottleneck in `<project_id>`?"*
- *"What's blocking ENG-42, and what does it unblock?"*

Claude Code decides when to call `build_feature_graph`, `rank_keystones`, and
`explain_blockers`, and explains the results using the tool output.

---

## How it works

```
Claude Code ──tool call──▶ PinchMCP (stdio)
                              │
              config ─▶ LinearGraphQLSource ──GraphQL──▶ api.linear.app
                              │
                         GraphCache (per project_id)
                              │
                       buildFeatureGraph
                       (normalize blocks/blocked_by → canonical edges)
                              │
              ┌───────────────┴───────────────┐
        rankKeystones                   explainBlockers
   (dominator tree, leverage)       (transitive chain walk)
              │                               │
        explainable text ◀── tool handlers ──▶ explainable text
```

- **Linear layer** (`src/linear/`) — a GraphQL client behind an `IssueSource`
  interface (the seam where a future MCP-to-MCP client could slot in), plus
  normalization of raw payloads into domain `Issue`/`Relation` types.
- **Graph layer** (`src/graph/`) — pure, I/O-free functions:
  - `buildFeatureGraph` normalizes `blocks`/`blocked_by` into one canonical
    "A unblocks B" edge direction, de-dups, drops out-of-project and self
    edges, and keeps `related`/`duplicate` as side metadata.
  - `rankKeystones` adds a virtual entry node to all unblocked tickets, computes
    a **dominator tree** (Cooper-Harvey-Kennedy), and sets each ticket's
    *leverage* to the size of its dominated subtree.
  - `explainBlockers` walks predecessors/successors transitively.
- **Cache** (`src/cache.ts`) — one built graph per `project_id`;
  `build_feature_graph` forces a refresh.
- **Tools** (`src/tools/`) — thin formatters turning graph results into
  human-readable, explainable output.

### Why dominators, not reachability

A node's *reachable descendants* counts everything downstream, including work
reachable by other paths too. A *dominator* is stricter: ticket X dominates
ticket Y only if **every** path to Y passes through X. That's the real
"if this slips, everything behind it slips" signal. The test suite includes a
bottleneck graph proving these two metrics diverge.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, modules, data types,
  request flow, error handling, design decisions, and extension points.
- [`docs/KEYSTONE-ALGORITHM.md`](docs/KEYSTONE-ALGORITHM.md) — the dominator
  analysis in depth: why dominators beat reachability, the Cooper–Harvey–Kennedy
  computation, leverage, edge cases, and complexity.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's shipped vs. planned across
  Phase I (explicit graph), Phase II (code grounding), and Phase III
  (generative scoping).
- [`docs/DECOMPOSITION-WORKFLOW.md`](docs/DECOMPOSITION-WORKFLOW.md) — how to
  break a free-text feature into grounded Linear tickets using `decompose_grounding`,
  Claude Code, and the Linear MCP together.

---

## Develop

```bash
npm test        # full vitest suite
npm run dev     # run from source via tsx (no build step)
npm run build   # compile to dist/ (emits src only, via tsconfig.build.json)
```

The graph algorithms are pure functions tested against synthetic fixtures with
hand-computed dominator trees; the Linear adapter is tested against a recorded
JSON fixture — no live API calls in the test suite.

---

## Roadmap

Phase I (this explicit-graph slice) is shipped. Phase II adds the inferred
code-coupling graph + `critical_path`; Phase III adds generative scoping (break
features into tickets, surface gaps). Full status — done vs. not — is tracked in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Known limitations (slice 1)

- Issues are paged at 50 per request to stay under Linear's 10k query-complexity
  cap (up to 10,000 issues across pages). A single issue's relations are capped
  at **50** per page — issues with more than 50 blocking relations would miss the
  overflow (implausible in practice, not yet paginated).
- `explain_blockers` doesn't annotate cycles, though `rank_keystones` does.
- Inferred direction from code coupling is *not* here yet — this slice uses only
  Linear's explicit, human-asserted relations.
