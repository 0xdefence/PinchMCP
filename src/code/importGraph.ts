import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { ImportGraph } from "./types.js";

// Captures the module specifier in:  from "x" | import "x" | require("x") | import("x")
const SPEC_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`]([^"'`]+)["'`]/g;

// Strips both line comments and block comments before import matching
const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_EXTS = [".ts", ".tsx", ".js", ".jsx"];

// Resolve a relative specifier from `fromFile` (repo-relative) to a repo-relative
// file path, or null if it isn't an intra-repo file.
function resolveImport(
  fromFile: string,
  spec: string,
  repoPath: string
): string | null {
  if (!spec.startsWith(".")) return null;
  const baseAbs = path.resolve(repoPath, path.dirname(fromFile), spec);

  // Strip a known extension and re-probe if the spec already had one.
  // This lets "./sub/c.js" resolve to "src/sub/c.ts" on disk.
  const specNoExt = EXTS.reduce(
    (s, e) => (s.endsWith(e) ? s.slice(0, -e.length) : s),
    baseAbs
  );

  const candidates: string[] = [
    // Extension-stripped variants (handles .js → .ts rewriting common in ESM TS)
    ...EXTS.map((e) => specNoExt + e),
    // Bare path with extensions appended
    ...EXTS.map((e) => baseAbs + e),
    // Index-file variants (directory imports)
    ...INDEX_EXTS.map((e) => path.join(baseAbs, "index" + e)),
    ...INDEX_EXTS.map((e) => path.join(specNoExt, "index" + e)),
  ];

  // Only include a bare (no-extension) path if it is a regular file, not a dir.
  if (existsSync(baseAbs)) {
    try {
      if (statSync(baseAbs).isFile()) candidates.unshift(baseAbs);
    } catch {
      // ignore stat errors
    }
  }

  const repoAbs = path.resolve(repoPath);
  for (const cand of candidates) {
    if (!existsSync(cand)) continue;
    try {
      if (!statSync(cand).isFile()) continue;
    } catch {
      continue;
    }
    if (!cand.startsWith(repoAbs)) continue;
    const rel = path.relative(repoAbs, cand);
    if (rel.startsWith("..")) continue;
    return rel.split(path.sep).join("/");
  }
  return null;
}

export async function buildImportGraph(
  repoPath: string,
  files: string[]
): Promise<ImportGraph> {
  const imports: ImportGraph = new Map();
  for (const f of files) {
    let content: string;
    try {
      content = await readFile(path.join(repoPath, f), "utf8");
    } catch {
      imports.set(f, new Set());
      continue;
    }
    const code = content.replace(COMMENT_RE, "");
    const targets = new Set<string>();
    for (const m of code.matchAll(SPEC_RE)) {
      const resolved = resolveImport(f, m[1], repoPath);
      if (resolved && resolved !== f) targets.add(resolved);
    }
    imports.set(f, targets);
  }
  return imports;
}
