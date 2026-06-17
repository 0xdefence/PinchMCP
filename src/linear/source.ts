import { Issue, Relation } from "./types.js";

export interface ProjectData {
  issues: Issue[];
  relations: Relation[];
}

// The swap seam: a future MCP-to-MCP client implements the same interface.
export interface IssueSource {
  fetchProject(projectId: string): Promise<ProjectData>;
}
