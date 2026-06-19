import {
  CoChangeMatrix,
  ImportGraph,
  LinkDirection,
  LinkSuggestion,
  TicketFiles,
} from "./types.js";

// Weighted, bounded contributions → a 0..1 score. Shared files are the
// strongest signal, then imports, then (correlational) co-change.
function scoreOf(shared: number, imports: number, coChange: number): number {
  const s = Math.min(1, shared / 3) * 0.5;
  const im = Math.min(1, imports / 3) * 0.3;
  const cc = Math.min(1, coChange / 5) * 0.2;
  return Math.round((s + im + cc) * 100) / 100;
}

export function coupleTickets(
  ticketFiles: TicketFiles[],
  imports: ImportGraph,
  coChange: CoChangeMatrix,
  opts: { minCoChange?: number } = {}
): LinkSuggestion[] {
  const minCoChange = opts.minCoChange ?? 2;
  const withFiles = ticketFiles.filter((t) => t.files.length > 0);
  const out: LinkSuggestion[] = [];

  for (let i = 0; i < withFiles.length; i++) {
    for (let j = i + 1; j < withFiles.length; j++) {
      const A = withFiles[i];
      const B = withFiles[j];
      const aFiles = new Set(A.files);
      const bFiles = new Set(B.files);

      const shared = A.files.filter((f) => bFiles.has(f));

      let aToB = 0;
      for (const fa of A.files)
        for (const t of imports.get(fa) ?? []) if (bFiles.has(t)) aToB++;
      let bToA = 0;
      for (const fb of B.files)
        for (const t of imports.get(fb) ?? []) if (aFiles.has(t)) bToA++;
      const importEdges = aToB + bToA;

      let cc = 0;
      for (const fa of A.files)
        for (const fb of B.files) if (fa !== fb) cc += coChange.get(fa, fb);

      if (shared.length === 0 && importEdges === 0 && cc < minCoChange) continue;

      const direction: LinkDirection =
        importEdges === 0
          ? "undirected"
          : aToB > bToA
            ? "a_depends_on_b"
            : bToA > aToB
              ? "b_depends_on_a"
              : "undirected";

      const evidence: string[] = [];
      if (shared.length) evidence.push(`share ${shared.length} file(s): ${shared.join(", ")}`);
      if (importEdges) evidence.push(`${importEdges} import edge(s) between their files`);
      if (cc) evidence.push(`co-changed in ${cc} commit(s)`);

      out.push({
        a: A.identifier,
        b: B.identifier,
        score: scoreOf(shared.length, importEdges, cc),
        direction,
        sharedFiles: shared.length,
        importEdges,
        coChangeWeight: cc,
        evidence,
      });
    }
  }

  return out.sort((x, y) => y.score - x.score);
}
