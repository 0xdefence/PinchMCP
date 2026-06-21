import { CodeIndex, Matcher, ScopeMatch } from "./types.js";

export class KeywordMatcher implements Matcher {
  constructor(
    private topK = 5,
    private minScore = 0.0001
  ) {}

  score(ticketTokens: string[], index: CodeIndex): ScopeMatch[] {
    const idf = (term: string) =>
      Math.log(1 + index.fileCount / (1 + (index.df.get(term) ?? 0)));
    const ticketSet = new Set(ticketTokens);
    const out: ScopeMatch[] = [];

    for (const [file, tokens] of index.docs) {
      const fileSet = new Set(tokens);
      const matched: { term: string; w: number }[] = [];
      let s = 0;
      for (const term of ticketSet) {
        const dft = index.df.get(term) ?? 0;
        if (fileSet.has(term) && dft < index.fileCount) {
          const w = idf(term);
          s += w;
          matched.push({ term, w });
        }
      }
      if (s > this.minScore && matched.length) {
        out.push({
          file,
          score: Math.round(s * 1000) / 1000,
          matchedTerms: matched.sort((a, b) => b.w - a.w).map((mm) => mm.term),
        });
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, this.topK);
  }
}
