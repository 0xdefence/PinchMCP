import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { LinearGraphQLSource } from "./linear/client.js";
import { resolveProjectId } from "./linear/resolveProject.js";
import { GraphCache } from "./cache.js";
import { buildFeatureGraphTool, ToolResult } from "./tools/buildFeatureGraph.js";
import { rankKeystonesTool } from "./tools/rankKeystones.js";
import { explainBlockersTool } from "./tools/explainBlockers.js";
import { criticalPathTool } from "./tools/criticalPath.js";
import { listProjectsTool } from "./tools/listProjects.js";
import { suggestLinksTool } from "./tools/suggestLinks.js";
import { suggestScopeTool } from "./tools/suggestScope.js";

function textResult(r: ToolResult) {
  return { content: [{ type: "text" as const, text: r.text }] };
}

async function main() {
  const config = loadConfig();
  const source = new LinearGraphQLSource(config.linearApiKey);
  const cache = new GraphCache(source);

  const server = new McpServer({ name: "pinch-mcp", version: "0.1.0" });

  server.registerTool(
    "list_projects",
    {
      title: "List Linear projects",
      description:
        "List the workspace's Linear projects with their ids and slugs, so a project_id can be chosen. Linear's project lookup needs a UUID or URL slug, not a display name.",
      inputSchema: {},
    },
    async () => textResult(await listProjectsTool(source))
  );

  const projectId = z
    .string()
    .describe("Linear project name, URL slug, or UUID");

  server.registerTool(
    "build_feature_graph",
    {
      title: "Build feature graph",
      description:
        "Fetch a Linear project's issues and blocking relations and (re)build the in-memory dependency graph. project_id accepts a project name, URL slug, or UUID.",
      inputSchema: { project_id: projectId },
    },
    async ({ project_id }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await buildFeatureGraphTool(cache, id));
    }
  );

  server.registerTool(
    "rank_keystones",
    {
      title: "Rank keystone tickets",
      description:
        "Rank tickets by leverage: how much downstream work each one gatekeeps, via dominator analysis of the blocking graph. project_id accepts a project name, URL slug, or UUID.",
      inputSchema: { project_id: projectId },
    },
    async ({ project_id }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await rankKeystonesTool(cache, id));
    }
  );

  server.registerTool(
    "critical_path",
    {
      title: "Critical path (CPM)",
      description:
        "Compute the critical path via CPM over ticket estimates: the longest-duration chain that sets the timeline, plus slack per ticket. Answers 'what sets total duration' (vs rank_keystones' 'max leverage unlock'). project_id accepts a project name, URL slug, or UUID.",
      inputSchema: { project_id: projectId },
    },
    async ({ project_id }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await criticalPathTool(cache, id));
    }
  );

  server.registerTool(
    "explain_blockers",
    {
      title: "Explain a ticket's blockers",
      description:
        "Show what transitively blocks a ticket and what it transitively unblocks. project_id accepts a project name, URL slug, or UUID.",
      inputSchema: { project_id: projectId, ticket_id: z.string() },
    },
    async ({ project_id, ticket_id }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await explainBlockersTool(cache, id, ticket_id));
    }
  );

  server.registerTool(
    "suggest_links",
    {
      title: "Suggest missing ticket links from code",
      description:
        "Infer coupling between tickets from the code they touch (shared files, intra-repo imports, git co-change) and suggest links Linear doesn't record. Suggestions only — never asserted; never folded into keystone/critical_path. project_id accepts a name, slug, or UUID; repo_path is the absolute path to the project's local git checkout.",
      inputSchema: {
        project_id: projectId,
        repo_path: z.string().describe("Absolute path to the project's local git checkout"),
      },
    },
    async ({ project_id, repo_path }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await suggestLinksTool(cache, id, repo_path));
    }
  );

  server.registerTool(
    "suggest_scope",
    {
      title: "Predict a ticket's code scope (cold-start)",
      description:
        "For tickets with no code yet, predict which code areas each will likely touch and which tickets likely couple — by matching ticket text against a keyword index of the repo. Planning aid: suggestions only, never asserted, never used in keystone/critical_path. project_id accepts a name, slug, or UUID; repo_path is the absolute path to the project's local git checkout.",
      inputSchema: {
        project_id: projectId,
        repo_path: z.string().describe("Absolute path to the project's local git checkout"),
      },
    },
    async ({ project_id, repo_path }) => {
      const id = await resolveProjectId(source, project_id);
      return textResult(await suggestScopeTool(cache, id, repo_path));
    }
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
