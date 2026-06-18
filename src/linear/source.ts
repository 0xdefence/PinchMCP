import { Issue, Relation } from "./types.js";

export interface ProjectData {
  issues: Issue[];
  relations: Relation[];
}

export interface ProjectSummary {
  id: string; // UUID accepted by fetchProject
  name: string;
  slugId: string | null; // trailing hex of the project URL, also accepted
}

// The swap seam: a future MCP-to-MCP client implements the same interface.
export interface IssueSource {
  fetchProject(projectId: string): Promise<ProjectData>;
  listProjects(): Promise<ProjectSummary[]>;
}
