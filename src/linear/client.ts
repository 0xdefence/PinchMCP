import { IssueSource, ProjectData } from "./source.js";
import { Issue, Relation, RelationType } from "./types.js";

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

// Issues are fetched one page at a time with a cursor. Linear caps query
// complexity at 10,000; a single batched query over a large project (issues x
// nested relations) blows past that and is rejected outright. Page size 50 with
// relations(first: 50) keeps each query at roughly a third of the cap.
const ISSUE_PAGE_SIZE = 50;
const RELATION_LIMIT = 50;
// Safety bound on pagination so a malformed cursor response can't loop forever.
const MAX_PAGES = 200; // 200 * 50 = 10,000 issues

const QUERY = `query($id: String!, $after: String) {
  project(id: $id) {
    issues(first: ${ISSUE_PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        estimate
        branchName
        state { name }
        relations(first: ${RELATION_LIMIT}) { nodes { type relatedIssue { id } } }
      }
    }
  }
}`;

interface IssuesPage {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: unknown[];
}

export class LinearGraphQLSource implements IssueSource {
  constructor(
    private apiKey: string,
    private fetchFn: typeof fetch = fetch
  ) {}

  async fetchProject(projectId: string): Promise<ProjectData> {
    const nodes: unknown[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const issues = await this.fetchPage(projectId, after);
      nodes.push(...(issues.nodes ?? []));

      if (!issues.pageInfo?.hasNextPage) {
        // Assemble the full graph from every page's nodes.
        return normalizeProject({ issues: { nodes } });
      }
      const next = issues.pageInfo.endCursor;
      if (!next || next === after) {
        // hasNextPage but no usable cursor — stop rather than loop forever.
        return normalizeProject({ issues: { nodes } });
      }
      after = next;
    }

    throw new Error(
      `Linear project ${projectId} exceeds ${MAX_PAGES * ISSUE_PAGE_SIZE} issues; aborting pagination.`
    );
  }

  private async fetchPage(
    projectId: string,
    after: string | null
  ): Promise<IssuesPage> {
    const res = await this.fetchFn(LINEAR_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { id: projectId, after },
      }),
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: { project?: { issues?: IssuesPage } };
      errors?: unknown;
    };
    if (json.errors) {
      throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    if (!json.data?.project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return json.data.project.issues ?? { nodes: [] };
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
