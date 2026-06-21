export interface CodeIndex {
  docs: Map<string, string[]>; // file -> its unique tokens
  df: Map<string, number>; // term -> number of files containing it
  fileCount: number;
}

export interface ScopeMatch {
  file: string;
  score: number;
  matchedTerms: string[]; // shared terms, most distinctive first
}

export interface Matcher {
  score(ticketTokens: string[], index: CodeIndex): ScopeMatch[];
}

export interface TicketScope {
  identifier: string;
  title: string;
  matches: ScopeMatch[];
  modules: string[];
}

export interface ScopeLink {
  a: string;
  b: string;
  score: number;
  sharedModules: string[];
  evidence: string[];
}

export interface SuggestScopeResult {
  tickets: TicketScope[];
  links: ScopeLink[];
  warnings: string[];
}
