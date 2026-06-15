import { IssueSource, ProjectData } from "./source.js";
import { Issue, Relation, RelationType } from "./types.js";

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

const QUERY = `query($id: String!) {
  project(id: $id) {
    issues(first: 250) {
      nodes {
        id
        identifier
        title
        estimate
        branchName
        state { name }
        relations { nodes { type relatedIssue { id } } }
      }
    }
  }
}`;

export class LinearGraphQLSource implements IssueSource {
  constructor(
    private apiKey: string,
    private fetchFn: typeof fetch = fetch
  ) {}

  async fetchProject(projectId: string): Promise<ProjectData> {
    const res = await this.fetchFn(LINEAR_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query: QUERY, variables: { id: projectId } }),
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: { project?: unknown };
      errors?: unknown;
    };
    if (json.errors) {
      throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    if (!json.data?.project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return normalizeProject(json.data.project);
  }
}

export function normalizeProject(project: any): ProjectData {
  const issueNodes: any[] = project?.issues?.nodes ?? [];

  const issues: Issue[] = issueNodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    state: n.state?.name ?? "unknown",
    estimate: n.estimate ?? null,
    branchName: n.branchName ?? null,
  }));

  const relations: Relation[] = [];
  const seen = new Set<string>();
  for (const n of issueNodes) {
    for (const r of n.relations?.nodes ?? []) {
      const target = r.relatedIssue?.id;
      if (!target) continue;
      const type = mapRelationType(r.type);
      if (!type) continue;
      const key = `${n.id}:${type}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({ type, fromIssueId: n.id, toIssueId: target });
    }
  }

  return { issues, relations };
}

function mapRelationType(t: string): RelationType | null {
  switch (t) {
    case "blocks":
      return "blocks";
    case "blocked":
    case "blocked_by":
      return "blocked_by";
    case "related":
      return "related";
    case "duplicate":
      return "duplicate";
    default:
      return null;
  }
}
