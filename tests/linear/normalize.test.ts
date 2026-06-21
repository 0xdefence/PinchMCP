import { describe, it, expect } from "vitest";
import { normalizeProject } from "../../src/linear/client.js";
import fixture from "../fixtures/linearProject.json" with { type: "json" };

describe("normalizeProject", () => {
  const data = normalizeProject(fixture);

  it("maps issues with state name, estimate and branchName", () => {
    expect(data.issues).toHaveLength(3);
    const eng1 = data.issues.find((i) => i.identifier === "ENG-1")!;
    expect(eng1.id).toBe("i1");
    expect(eng1.state).toBe("In Progress");
    expect(eng1.estimate).toBe(3);
    expect(eng1.branchName).toBe("eng-1-auth-refactor");
  });

  it("defaults missing estimate/branchName to null", () => {
    const eng2 = data.issues.find((i) => i.identifier === "ENG-2")!;
    expect(eng2.estimate).toBeNull();
    expect(eng2.branchName).toBeNull();
  });

  it("produces a blocks relation from source to relatedIssue", () => {
    const blocks = data.relations.filter((r) => r.type === "blocks");
    expect(blocks).toContainEqual({ type: "blocks", fromIssueId: "i1", toIssueId: "i2" });
  });

  it("keeps the out-of-project relation (build layer filters it)", () => {
    expect(data.relations).toContainEqual({ type: "blocks", fromIssueId: "i1", toIssueId: "ghost" });
  });

  it("maps related relations", () => {
    expect(data.relations).toContainEqual({ type: "related", fromIssueId: "i3", toIssueId: "i1" });
  });

  it("skips unknown relation types", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1",
            identifier: "ENG-9",
            title: "Thing",
            estimate: null,
            branchName: null,
            state: { name: "Todo" },
            relations: { nodes: [{ type: "clones", relatedIssue: { id: "x2" } }] },
          },
        ],
      },
    });
    expect(data.relations).toHaveLength(0);
  });

  it("skips relations with no relatedIssue id", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1",
            identifier: "ENG-9",
            title: "Thing",
            estimate: null,
            branchName: null,
            state: { name: "Todo" },
            relations: { nodes: [{ type: "blocks", relatedIssue: null }] },
          },
        ],
      },
    });
    expect(data.relations).toHaveLength(0);
  });

  it("defaults missing state to 'unknown'", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1",
            identifier: "ENG-9",
            title: "Thing",
            estimate: null,
            branchName: null,
            state: null,
            relations: { nodes: [] },
          },
        ],
      },
    });
    expect(data.issues[0].state).toBe("unknown");
  });

  it("de-duplicates identical relations on the same issue", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1",
            identifier: "ENG-9",
            title: "Thing",
            estimate: null,
            branchName: null,
            state: { name: "Todo" },
            relations: {
              nodes: [
                { type: "blocks", relatedIssue: { id: "x2" } },
                { type: "blocks", relatedIssue: { id: "x2" } },
              ],
            },
          },
        ],
      },
    });
    expect(data.relations).toHaveLength(1);
  });

  it("extracts GitHub PR numbers from issue attachments", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1", identifier: "ENG-9", title: "T", estimate: null,
            branchName: null, state: { name: "Todo" },
            relations: { nodes: [] },
            attachments: {
              nodes: [
                { url: "https://github.com/0xdefence/0xDefend/pull/44" },
                { url: "https://github.com/0xdefence/0xDefend/pull/44" },
                { url: "https://linear.app/whatever" },
              ],
            },
          },
        ],
      },
    });
    expect(data.issues[0].prNumbers).toEqual([44]);
  });

  it("defaults prNumbers to [] when there are no attachments", () => {
    const data = normalizeProject({
      issues: {
        nodes: [
          {
            id: "x1", identifier: "ENG-9", title: "T", estimate: null,
            branchName: null, state: { name: "Todo" }, relations: { nodes: [] },
          },
        ],
      },
    });
    expect(data.issues[0].prNumbers).toEqual([]);
  });

  it("carries the issue description (empty string when absent)", () => {
    const data = normalizeProject({
      issues: { nodes: [
        { id: "x1", identifier: "ENG-9", title: "T", description: "build the econ simulator agent",
          estimate: null, branchName: null, state: { name: "Todo" }, relations: { nodes: [] } },
        { id: "x2", identifier: "ENG-10", title: "U",
          estimate: null, branchName: null, state: { name: "Todo" }, relations: { nodes: [] } },
      ] },
    });
    expect(data.issues[0].description).toBe("build the econ simulator agent");
    expect(data.issues[1].description).toBe("");
  });

  it("carries the assignee name (null when unassigned)", () => {
    const data = normalizeProject({
      issues: { nodes: [
        { id: "x1", identifier: "ENG-9", title: "T", estimate: null, branchName: null,
          state: { name: "Todo" }, relations: { nodes: [] }, assignee: { name: "Ada" } },
        { id: "x2", identifier: "ENG-10", title: "U", estimate: null, branchName: null,
          state: { name: "Todo" }, relations: { nodes: [] } },
      ] },
    });
    expect(data.issues[0].assignee).toBe("Ada");
    expect(data.issues[1].assignee).toBeNull();
  });
});
