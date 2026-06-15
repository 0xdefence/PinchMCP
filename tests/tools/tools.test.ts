import { describe, it, expect } from "vitest";
import { GraphCache } from "../../src/cache.js";
import { StubSource, sampleProject } from "../fixtures/stubSource.js";
import { buildFeatureGraphTool } from "../../src/tools/buildFeatureGraph.js";
import { rankKeystonesTool } from "../../src/tools/rankKeystones.js";
import { explainBlockersTool } from "../../src/tools/explainBlockers.js";

const newCache = () => new GraphCache(new StubSource(sampleProject));

describe("tool handlers", () => {
  it("build_feature_graph reports node and edge counts", async () => {
    const r = await buildFeatureGraphTool(newCache(), "p1");
    expect(r.text).toMatch(/3 issues/);
    expect(r.text).toMatch(/2 blocking edges/);
  });

  it("rank_keystones names the keystone and explains it", async () => {
    const r = await rankKeystonesTool(newCache(), "p1");
    // ENG-1 (a) dominates ENG-2 and ENG-3.
    expect(r.text).toMatch(/ENG-1/);
    expect(r.text).toMatch(/leverage 2/);
    expect(r.text).toMatch(/passes through it/);
  });

  it("explain_blockers describes upstream and downstream", async () => {
    const r = await explainBlockersTool(newCache(), "p1", "ENG-2");
    expect(r.text).toMatch(/ENG-2 is blocked by 1/);
    expect(r.text).toMatch(/ENG-1/);
  });

  it("explain_blockers reports a missing ticket cleanly", async () => {
    const r = await explainBlockersTool(newCache(), "p1", "ENG-999");
    expect(r.text).toMatch(/not found/i);
  });
});
