# PinchMCP

An MCP server that finds the **keystone** ticket in a Linear feature — the one
that, once done, unblocks the most downstream work — via dominator analysis of
the blocking-relation graph.

This is slice 1: the explicit-graph path. Code-coupling inference comes later.

## Tools

- `build_feature_graph(project_id)` — fetch issues + relations, build the graph.
- `rank_keystones(project_id)` — rank tickets by downstream leverage, with
  plain-language explanations.
- `explain_blockers(project_id, ticket_id)` — transitive blockers and unblocks
  for one ticket.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `LINEAR_API_KEY` (Linear → Settings →
   Security & access → Personal API keys).
3. `npm run build`

## Run

The server speaks MCP over stdio. Register it with your MCP client (e.g. Claude
Code) pointing at `dist/index.js`, with `LINEAR_API_KEY` set in the environment.

## Develop

- `npm test` — run the test suite.
- `npm run dev` — run from source via tsx.
