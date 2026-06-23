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
  // Relate tickets by shared MODULE, not exact file: a feature and a ticket can
  // land in the same area (e.g. packages/agents/src/agents) without their top-K
  // predicted files matching path-for-path.
  const featureModules = new Set(predictedModules);

  const relatedTickets: RelatedTicket[] = ticketScopes
    .map((ts) => {
      const shared = ts.matches.filter((m) => featureModules.has(moduleOf(m.file)));
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
