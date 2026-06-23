import { CodeIndex, Matcher, ScopeMatch, TicketScope } from "./types.js";
import { tokenize } from "./tokenize.js";
import { moduleOf } from "./scopeCouple.js";

export interface RelatedTicket {
  identifier: string;
  sharedModules: string[];
  terms: string[];
}

export interface FeatureGrounding {
  predictedModules: string[];
  matchedFiles: ScopeMatch[];
  relatedTickets: RelatedTicket[];
}

export function groundFeature(
  featureText: string,
  index: CodeIndex,
  ticketScopes: TicketScope[],
  matcher: Matcher
): FeatureGrounding {
  const matchedFiles = matcher.score(tokenize(featureText), index);
  const predictedModules = [...new Set(matchedFiles.map((m) => moduleOf(m.file)))];
  const featureFiles = new Set(matchedFiles.map((m) => m.file));

  const relatedTickets: RelatedTicket[] = ticketScopes
    .map((ts) => {
      const shared = ts.matches.filter((m) => featureFiles.has(m.file));
      if (!shared.length) return null;
      return {
        identifier: ts.identifier,
        sharedModules: [...new Set(shared.map((m) => moduleOf(m.file)))],
        terms: [...new Set(shared.flatMap((m) => m.matchedTerms))].slice(0, 6),
      };
    })
    .filter((x): x is RelatedTicket => x !== null);

  return { predictedModules, matchedFiles, relatedTickets };
}
