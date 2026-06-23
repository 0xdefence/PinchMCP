import { ScopeLink, TicketScope } from "./types.js";

export function moduleOf(file: string): string {
  const dir = file.split("/").slice(0, -1).join("/");
  return dir || file;
}

export function scopeCouple(
  scopes: TicketScope[],
  isLinked: (a: string, b: string) => boolean,
  opts: { minShared?: number } = {}
): ScopeLink[] {
  const minShared = opts.minShared ?? 1;
  const out: ScopeLink[] = [];

  for (let i = 0; i < scopes.length; i++) {
    for (let j = i + 1; j < scopes.length; j++) {
      const A = scopes[i];
      const B = scopes[j];
      if (isLinked(A.identifier, B.identifier)) continue;

      const aScore = new Map(A.matches.map((m) => [m.file, m.score]));
      const shared = B.matches.filter((m) => aScore.has(m.file));
      if (shared.length < minShared) continue;

      const sharedModules = [...new Set(shared.map((m) => moduleOf(m.file)))];
      const terms = [...new Set(shared.flatMap((m) => m.matchedTerms))].slice(0, 6);
      const raw = shared.reduce(
        (s, m) => s + Math.min(m.score, aScore.get(m.file)!),
        0
      );
      const score = Math.round(Math.min(1, raw / 3) * 100) / 100;

      out.push({
        a: A.identifier,
        b: B.identifier,
        score,
        sharedModules,
        evidence: [`both likely touch ${sharedModules.join(", ")} (terms: ${terms.join(", ")})`],
      });
    }
  }

  return out.sort((x, y) => y.score - x.score);
}
