import { IssueSource } from "./linear/source.js";
import { buildFeatureGraph } from "./graph/build.js";
import { FeatureGraph } from "./graph/types.js";

export class GraphCache {
  private cache = new Map<string, FeatureGraph>();
  constructor(private source: IssueSource) {}

  async getOrBuild(projectId: string): Promise<FeatureGraph> {
    const existing = this.cache.get(projectId);
    if (existing) return existing;
    return this.rebuild(projectId);
  }

  async rebuild(projectId: string): Promise<FeatureGraph> {
    const { issues, relations } = await this.source.fetchProject(projectId);
    const graph = buildFeatureGraph(issues, relations);
    this.cache.set(projectId, graph);
    return graph;
  }
}
