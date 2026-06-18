import { describe, it, expect } from "vitest";
import { LinearGraphQLSource } from "../../src/linear/client.js";

// Minimal stand-in for a fetch Response.
function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function issueNode(id: string, identifier: string, relations: any[] = []) {
  return {
    id,
    identifier,
    title: `Title ${identifier}`,
    estimate: null,
    branchName: null,
    state: { name: "Todo" },
    relations: { nodes: relations },
  };
}

function page(nodes: unknown[], hasNextPage: boolean, endCursor: string | null) {
  return response({
    data: { project: { issues: { pageInfo: { hasNextPage, endCursor }, nodes } } },
  });
}

describe("LinearGraphQLSource.fetchProject pagination", () => {
  it("pages through all issues and threads the cursor", async () => {
    const cursors: (string | null)[] = [];
    const fetchFn = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      cursors.push(body.variables.after ?? null);
      if (body.variables.after == null) {
        return page(
          [issueNode("i1", "ENG-1", [{ type: "blocks", relatedIssue: { id: "i2" } }])],
          true,
          "cursor1"
        );
      }
      return page([issueNode("i2", "ENG-2")], false, null);
    }) as unknown as typeof fetch;

    const data = await new LinearGraphQLSource("key", fetchFn).fetchProject("p1");

    // Both pages assembled into one graph.
    expect(data.issues.map((i) => i.identifier).sort()).toEqual(["ENG-1", "ENG-2"]);
    // Relation from page 1 survives.
    expect(data.relations).toContainEqual({
      type: "blocks",
      fromIssueId: "i1",
      toIssueId: "i2",
    });
    // First call has no cursor; second call uses the page-1 endCursor.
    expect(cursors).toEqual([null, "cursor1"]);
  });

  it("stops after one page when hasNextPage is false", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return page([issueNode("i1", "ENG-1")], false, null);
    }) as unknown as typeof fetch;

    await new LinearGraphQLSource("key", fetchFn).fetchProject("p1");
    expect(calls).toBe(1);
  });

  it("does not loop forever when a cursor is missing despite hasNextPage", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return page([issueNode("i1", "ENG-1")], true, null); // hasNextPage but no cursor
    }) as unknown as typeof fetch;

    const data = await new LinearGraphQLSource("key", fetchFn).fetchProject("p1");
    expect(calls).toBe(1);
    expect(data.issues).toHaveLength(1);
  });

  it("throws on a non-ok HTTP response", async () => {
    const fetchFn = (async () =>
      response("rate limited", false, 429)) as unknown as typeof fetch;
    await expect(
      new LinearGraphQLSource("key", fetchFn).fetchProject("p1")
    ).rejects.toThrow(/429/);
  });

  it("throws when the project is missing", async () => {
    const fetchFn = (async () =>
      response({ data: { project: null } })) as unknown as typeof fetch;
    await expect(
      new LinearGraphQLSource("key", fetchFn).fetchProject("bad-id")
    ).rejects.toThrow(/Project not found/);
  });
});
