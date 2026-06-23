import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { tokenize } from "./tokenize.js";
import { CodeIndex } from "./types.js";

const ID_RE =
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const MAX_FILE_BYTES = 200_000;

export async function buildCodeIndex(
  repoPath: string,
  files: string[]
): Promise<CodeIndex> {
  const docs = new Map<string, string[]>();
  const df = new Map<string, number>();

  for (const f of files) {
    let content: string;
    try {
      content = await readFile(path.join(repoPath, f), "utf8");
    } catch {
      continue;
    }
    if (content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES);

    const tokens = new Set<string>();
    for (const t of tokenize(f.replace(/\.[^./]+$/, ""))) tokens.add(t);
    for (const m of content.matchAll(ID_RE)) for (const t of tokenize(m[1])) tokens.add(t);
    const comments = content.match(COMMENT_RE)?.join(" ") ?? "";
    for (const t of tokenize(comments)) tokens.add(t);

    const arr = [...tokens];
    docs.set(f, arr);
    for (const t of arr) df.set(t, (df.get(t) ?? 0) + 1);
  }

  return { docs, df, fileCount: docs.size };
}
