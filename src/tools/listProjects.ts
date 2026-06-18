import { IssueSource } from "../linear/source.js";
import { ToolResult } from "./buildFeatureGraph.js";

export async function listProjectsTool(
  source: IssueSource
): Promise<ToolResult> {
  const projects = await source.listProjects();
  if (!projects.length) {
    return { text: "No Linear projects found.", structured: { projects: [] } };
  }
  const lines = projects.map((p) => {
    const slug = p.slugId ? ` (slug: ${p.slugId})` : "";
    return `- ${p.name} — id: ${p.id}${slug}`;
  });
  return {
    text: `Linear projects (${projects.length}). Pass an id (or slug) as project_id:\n${lines.join("\n")}`,
    structured: { projects },
  };
}
