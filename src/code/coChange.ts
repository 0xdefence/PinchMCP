import { Commit, CoChangeMatrix } from "./types.js";

const SEP = "\x00";
const key = (a: string, b: string) => (a < b ? a + SEP + b : b + SEP + a);

export function buildCoChange(
  commits: Commit[],
  maxFilesPerCommit = 40
): CoChangeMatrix {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const files = [...new Set(c.files)].sort();
    if (files.length < 2 || files.length > maxFilesPerCommit) continue;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const k = key(files[i], files[j]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return {
    get(a: string, b: string): number {
      if (a === b) return 0;
      return counts.get(key(a, b)) ?? 0;
    },
  };
}
