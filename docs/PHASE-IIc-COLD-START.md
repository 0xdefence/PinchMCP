# Phase II-c — Cold-start semantic matching (Design Spec)

Status: **decisions locked, pre-implementation.**

## Why

Code-grounding (II-b) maps tickets → code via commits/PRs. A forward-looking
backlog has no commits, so it correctly returns nothing — proven on the real
0xDefend backlog (ELI-20–38, all pre-code). Cold-start matching answers the
*planning* question instead: **which code areas will a ticket likely touch, and
which tickets likely couple — predicted from ticket text, before any code lands.**
Lower confidence than git-derived coupling; available the moment a ticket exists.

## Locked decisions

| Decision | Choice |
|---|---|
| Matcher | **Keyword / TF-IDF**, behind a `Matcher` seam. **No embeddings** — preserves pinch's deterministic, offline, secret-free identity (the architecture doc's "no LLM, no embedding" line). An embedding backend can slot behind the seam later if recall demands. |
| Index granularity | **File-level** documents (path tokens + extracted identifiers + comment words). Symbol-level deferred. |
| Surface | **Standalone `suggest_scope` tool** — separate from `suggest_links` because predicted coupling has very different confidence semantics from git-derived coupling. |
| Ticket text | title **+ description** (new Linear fetch). |
| Contract | Suggestions only, evidence-carrying (matched terms), confirm-before-acting. **Never folded into keystone/CPM.** |

## Architecture — new `src/scope/` layer

```
src/scope/
  tokenize.ts     tokenize(text): string[] — split camelCase/snake/kebab, lowercase, drop stopwords & short tokens
  codeIndex.ts    buildCodeIndex(repoPath, sourceFiles): CodeIndex — per-file token docs + corpus df for IDF
  match.ts        Matcher interface + KeywordMatcher (TF-IDF): score(ticketTokens, index) -> ranked {file, score, matchedTerms}
  scopeCouple.ts  ticket↔ticket coupling from overlapping predicted files
src/code/git.ts   + listSourceFiles(repoPath) (git ls-files, filtered to source extensions)
src/linear/*      Issue/GraphNode gain description?: string (fetched + threaded like prNumbers)
src/tools/suggestScope.ts   the suggest_scope tool
src/index.ts      register suggest_scope
```

## Data shapes

```ts
interface CodeIndex {
  docs: Map<string, string[]>;     // file -> its tokens
  df: Map<string, number>;          // term -> number of files containing it
  fileCount: number;
}
interface ScopeMatch { file: string; score: number; matchedTerms: string[] }
interface TicketScope {
  identifier: string;
  title: string;
  matches: ScopeMatch[];            // top predicted files
  modules: string[];                // matches grouped to dir/module for readability
}
interface ScopeLink {
  a: string; b: string;             // identifiers
  score: number;
  sharedModules: string[];
  evidence: string[];
}
interface SuggestScopeResult {
  tickets: TicketScope[];
  links: ScopeLink[];
  warnings: string[];
}
```

## Matching (TF-IDF, deterministic)

- **Index:** for each source file, document = tokens from its **path** + **identifiers** (regex over `export`/`function`/`class`/`const`/`type`/`interface` names) + **comment words**. `df[term]` = number of files containing the term; `fileCount` = N.
- **Score** ticket → file: `sum over terms shared between ticketTokens and file's tokens of idf(term)`, where `idf(term) = ln(1 + fileCount / (1 + df[term]))`. Rare/distinctive terms dominate; ubiquitous terms (e.g. `index`, `const`) contribute ~0. Presence-based (not raw TF) to keep it robust and explainable.
- **matchedTerms:** the shared terms, sorted by idf desc (most distinctive first) — this is the evidence.
- **Threshold:** keep files with score above a floor; top **K = 5** per ticket.
- **Matcher seam:** `interface Matcher { score(ticketTokens: string[], index: CodeIndex): ScopeMatch[] }`. `KeywordMatcher` implements it; an embedding matcher could later.

## Cross-ticket coupling

Two tickets whose predicted files overlap are likely coupled. `scopeCouple`
pairs tickets by shared predicted files (weighted by the files' rank/idf),
**undirected** (semantic prediction implies no direction), conservative
threshold, evidence = shared modules + the distinctive terms behind them.
Already-explicit Linear links (successors **and** relatedMeta) are excluded —
same dedup as `suggest_links`.

## Output (suggest_scope)

```
Predicted scope for <project> (planning aid — confirm before acting; not asserted):

Per ticket:
- ELI-28 "econ-simulator agent" → likely touches src/agents/, src/sim/harness.ts
  (matched: simulator, agent, harness, econ)
- ELI-30 "invariant-formalizer" → likely touches src/agents/, src/analysis/invariants.ts
  (matched: invariant, formalizer, agent)

Likely couplings (consider linking in Linear):
- ELI-28 ↔ ELI-30 (score 0.6) — both likely touch src/agents/ (terms: agent, base)

No confident match for: ELI-32 (app-backend — no analogous code in repo yet).
```

## Edge cases

| Condition | Behavior |
|---|---|
| Not a git repo | Structured error (reuse `isGitRepo`). |
| Repo has no source files | "No codebase to match against." |
| Ticket has no description / generic title | Few tokens after stopwords → weak/no match; reported as "no confident match." |
| Ticket about a genuinely new module (no analog) | Correctly returns no match — honest. |
| Huge repo | Cap indexed files (skip files > N bytes; cap total count) + warn. |

## Testing

- `tokenize` — camelCase/snake/kebab split, lowercasing, stopword + short-token drop.
- `codeIndex` (temp repo) — path tokens + identifiers extracted; `df`/`fileCount` correct; node_modules/dist excluded (git ls-files only tracks source).
- `KeywordMatcher` — a ticket sharing a distinctive term with one file ranks it top; a ubiquitous term doesn't dominate (idf); `matchedTerms` are the shared distinctive terms.
- `scopeCouple` — two tickets matching the same file produce an undirected suggestion; already-linked pair excluded.
- `suggest_scope` (temp repo end-to-end) — ticket text matches a module; cross-ticket coupling surfaces; not-a-repo errors; no-source-files warns.

## Out of scope (this iteration)

- Embeddings (seam reserved).
- Symbol-level granularity / call-graph-aware prediction.
- Stemming/lemmatization beyond camel/snake/kebab splitting + stopwords.
- Folding predicted coupling into `suggest_links` or keystone/CPM.
