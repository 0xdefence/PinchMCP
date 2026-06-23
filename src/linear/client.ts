import { IssueSource, ProjectData, ProjectSummary } from "./source.js";
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
        description
        estimate
        branchName
        state { name type }
        assignee { name }
        relations(first: ${RELATION_LIMIT}) { nodes { type relatedIssue { id } } }
        attachments(first: 25) { nodes { url } }
      }
    }
  }
}`;

const PROJECTS_PAGE_SIZE = 100;

const PROJECTS_QUERY = `query($after: String) {
  projects(first: ${PROJECTS_PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id name slugId }
  }
}`;

interface Page<T> {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: T[];
}

export class LinearGraphQLSource implements IssueSource {
  constructor(
    private apiKey: string,
    private fetchFn: typeof fetch = fetch
  ) {}

  async fetchProject(projectId: string): Promise<ProjectData> {
    const nodes = await this.paginate<unknown>(
      (after) =>
        this.post(QUERY, { id: projectId, after }).then((data) => {
          if (!data?.project) {
            throw new Error(`Project not found: ${projectId}`);
          }
          return (data.project.issues ?? { nodes: [] }) as Page<unknown>;
        }),
      `project ${projectId} issue list`
    );
    // Assemble the full graph from every page's nodes.
    return normalizeProject({ issues: { nodes } });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const nodes = await this.paginate<any>(
      (after) =>
        this.post(PROJECTS_QUERY, { after }).then(
          (data) => (data?.projects ?? { nodes: [] }) as Page<any>
        ),
      "project list"
    );
    return nodes.map((n) => ({
      id: n.id,
      name: n.name,
      slugId: n.slugId ?? null,
    }));
  }

  // Walk a cursor-paginated connection, accumulating every page's nodes.
  private async paginate<T>(
    fetchPage: (after: string | null) => Promise<Page<T>>,
    label: string
  ): Promise<T[]> {
    const out: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const conn = await fetchPage(after);
      out.push(...(conn.nodes ?? []));
      const next = conn.pageInfo?.endCursor;
      // Stop on the last page, or if the cursor can't advance (avoids looping).
      if (!conn.pageInfo?.hasNextPage || !next || next === after) return out;
      after = next;
    }
    throw new Error(
      `${label} exceeds ${MAX_PAGES} pages; aborting pagination.`
    );
  }

  // Single GraphQL POST with shared HTTP + error handling. Returns `data`.
  private async post(
    query: string,
    variables: Record<string, unknown>
  ): Promise<any> {
    const res = await this.fetchFn(LINEAR_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: any; errors?: unknown };
    if (json.errors) {
      throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  }
}

export function normalizeProject(project: any): ProjectData {
  const issueNodes: any[] = project?.issues?.nodes ?? [];

  const issues: Issue[] = issueNodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    state: n.state?.name ?? "unknown",
    stateType: n.state?.type ?? "",
    estimate: n.estimate ?? null,
    branchName: n.branchName ?? null,
    assignee: n.assignee?.name ?? null,
    description: n.description ?? "",
    prNumbers: extractPrNumbers(n.attachments?.nodes ?? []),
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

function extractPrNumbers(nodes: any[]): number[] {
  const nums = new Set<number>();
  for (const a of nodes) {
    const m = String(a?.url ?? "").match(
      /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i
    );
    if (m) nums.add(Number(m[1]));
  }
  return [...nums];
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
