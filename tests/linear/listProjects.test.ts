import { describe, it, expect } from "vitest";
import { LinearGraphQLSource } from "../../src/linear/client.js";

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function projectsPage(
  nodes: unknown[],
  hasNextPage: boolean,
  endCursor: string | null
) {
  return response({
    data: { projects: { pageInfo: { hasNextPage, endCursor }, nodes } },
  });
}

describe("LinearGraphQLSource.listProjects", () => {
  it("normalizes id/name/slugId and pages through all projects", async () => {
    const cursors: (string | null)[] = [];
    const fetchFn = (async (_url: string, init: any) => {
      const after = JSON.parse(init.body).variables.after ?? null;
      cursors.push(after);
      if (after == null) {
        return projectsPage(
          [{ id: "u1", name: "Alpha", slugId: "alpha-aaa111" }],
          true,
          "c1"
        );
      }
      return projectsPage([{ id: "u2", name: "Beta", slugId: null }], false, null);
    }) as unknown as typeof fetch;

    const projects = await new LinearGraphQLSource("key", fetchFn).listProjects();

    expect(projects).toEqual([
      { id: "u1", name: "Alpha", slugId: "alpha-aaa111" },
      { id: "u2", name: "Beta", slugId: null },
    ]);
    expect(cursors).toEqual([null, "c1"]); // cursor threaded across pages
  });

  it("returns an empty list when there are no projects", async () => {
    const fetchFn = (async () =>
      projectsPage([], false, null)) as unknown as typeof fetch;
    expect(await new LinearGraphQLSource("key", fetchFn).listProjects()).toEqual([]);
  });

  it("throws on a non-ok response", async () => {
    const fetchFn = (async () =>
      response("nope", false, 401)) as unknown as typeof fetch;
    await expect(
      new LinearGraphQLSource("key", fetchFn).listProjects()
    ).rejects.toThrow(/401/);
  });
});
