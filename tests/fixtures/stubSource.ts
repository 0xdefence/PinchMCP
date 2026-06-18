import { IssueSource, ProjectData, ProjectSummary } from "../../src/linear/source.js";

export class StubSource implements IssueSource {
  public calls = 0;
  constructor(
    private data: ProjectData,
    private projects: ProjectSummary[] = [
      { id: "p1", name: "Sample Project", slugId: "sample-abc123" },
    ]
  ) {}
  async fetchProject(_projectId: string): Promise<ProjectData> {
    this.calls++;
    return this.data;
  }
  async listProjects(): Promise<ProjectSummary[]> {
    return this.projects;
  }
}

export const sampleProject: ProjectData = {
  issues: [
    { id: "a", identifier: "ENG-1", title: "Auth", state: "Todo", estimate: null, branchName: null },
    { id: "b", identifier: "ENG-2", title: "Session", state: "Todo", estimate: null, branchName: null },
    { id: "c", identifier: "ENG-3", title: "Login", state: "Todo", estimate: null, branchName: null },
  ],
  relations: [
    { type: "blocks", fromIssueId: "a", toIssueId: "b" },
    { type: "blocks", fromIssueId: "a", toIssueId: "c" },
  ],
};
