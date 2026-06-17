import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { LinearGraphQLSource } from "./linear/client.js";
import { GraphCache } from "./cache.js";
import { buildFeatureGraphTool, ToolResult } from "./tools/buildFeatureGraph.js";
import { rankKeystonesTool } from "./tools/rankKeystones.js";
import { explainBlockersTool } from "./tools/explainBlockers.js";

function textResult(r: ToolResult) {
  return { content: [{ type: "text" as const, text: r.text }] };
}

async function main() {
  const config = loadConfig();
  const source = new LinearGraphQLSource(config.linearApiKey);
  const cache = new GraphCache(source);

  const server = new McpServer({ name: "pinch-mcp", version: "0.1.0" });

  server.registerTool(
    "build_feature_graph",
    {
      title: "Build feature graph",
      description:
        "Fetch a Linear project's issues and blocking relations and (re)build the in-memory dependency graph.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) =>
      textResult(await buildFeatureGraphTool(cache, project_id))
  );

  server.registerTool(
    "rank_keystones",
    {
      title: "Rank keystone tickets",
      description:
        "Rank tickets by leverage: how much downstream work each one gatekeeps, via dominator analysis of the blocking graph.",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) =>
      textResult(await rankKeystonesTool(cache, project_id))
  );

  server.registerTool(
    "explain_blockers",
    {
      title: "Explain a ticket's blockers",
      description:
        "Show what transitively blocks a ticket and what it transitively unblocks.",
      inputSchema: { project_id: z.string(), ticket_id: z.string() },
    },
    async ({ project_id, ticket_id }) =>
      textResult(await explainBlockersTool(cache, project_id, ticket_id))
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
