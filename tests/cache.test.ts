import { describe, it, expect } from "vitest";
import { GraphCache } from "../src/cache.js";
import { StubSource, sampleProject } from "./fixtures/stubSource.js";

describe("GraphCache", () => {
  it("builds and caches per project (one fetch for repeated reads)", async () => {
    const source = new StubSource(sampleProject);
    const cache = new GraphCache(source);
    const g1 = await cache.getOrBuild("p1");
    const g2 = await cache.getOrBuild("p1");
    expect(g1).toBe(g2);
    expect(source.calls).toBe(1);
    expect(g1.nodes.size).toBe(3);
  });

  it("rebuild re-fetches and replaces the cached graph", async () => {
    const source = new StubSource(sampleProject);
    const cache = new GraphCache(source);
    await cache.getOrBuild("p1");
    await cache.rebuild("p1");
    expect(source.calls).toBe(2);
  });
});
