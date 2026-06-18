import { describe, it, expect } from "vitest";
import { resolveProjectId } from "../../src/linear/resolveProject.js";
import { IssueSource, ProjectData, ProjectSummary } from "../../src/linear/source.js";

class FakeSource implements IssueSource {
  public listCalls = 0;
  constructor(private projects: ProjectSummary[]) {}
  async fetchProject(): Promise<ProjectData> {
    throw new Error("fetchProject not used in resolver tests");
  }
  async listProjects(): Promise<ProjectSummary[]> {
    this.listCalls++;
    return this.projects;
  }
}

const projects: ProjectSummary[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "0xDefence", slugId: "0xdefence-abc123def456" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Polyweather Bot", slugId: "polyweather-xyz789" },
  { id: "33333333-3333-3333-3333-333333333333", name: "SeaGuard", slugId: "seaguard-aaa000" },
];

const UUID = "11111111-1111-1111-1111-111111111111";

describe("resolveProjectId", () => {
  it("passes a UUID through without calling listProjects", async () => {
    const src = new FakeSource(projects);
    expect(await resolveProjectId(src, UUID)).toBe(UUID);
    expect(src.listCalls).toBe(0);
  });

  it("resolves a case-insensitive exact name", async () => {
    expect(await resolveProjectId(new FakeSource(projects), "0xdefence")).toBe(UUID);
  });

  it("resolves a URL slug to the project id", async () => {
    expect(
      await resolveProjectId(new FakeSource(projects), "0xdefence-abc123def456")
    ).toBe(UUID);
  });

  it("resolves a unique substring match", async () => {
    expect(await resolveProjectId(new FakeSource(projects), "weather")).toBe(
      "22222222-2222-2222-2222-222222222222"
    );
  });

  it("throws a disambiguation error on multiple name matches", async () => {
    const dupes: ProjectSummary[] = [
      { id: "a", name: "Auth Service", slugId: null },
      { id: "b", name: "Auth Gateway", slugId: null },
    ];
    await expect(
      resolveProjectId(new FakeSource(dupes), "auth")
    ).rejects.toThrow(/matches multiple projects/i);
  });

  it("throws a helpful error when nothing matches", async () => {
    await expect(
      resolveProjectId(new FakeSource(projects), "nonexistent")
    ).rejects.toThrow(/No Linear project matches/i);
  });

  it("passes through an unknown slug-shaped reference", async () => {
    // Not in the list, but looks like a slug — let Linear decide.
    expect(
      await resolveProjectId(new FakeSource(projects), "ghost-deadbeef00")
    ).toBe("ghost-deadbeef00");
  });
});
