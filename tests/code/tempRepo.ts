import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// A throwaway git repo for tests. Each commit takes a message + a map of
// repo-relative path -> file contents.
export function makeRepo(
  commits: { message: string; files: Record<string, string> }[]
): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pinch-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  for (const c of commits) {
    for (const [rel, content] of Object.entries(c.files)) {
      const abs = path.join(dir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    git("add", "-A");
    git("commit", "-q", "-m", c.message);
  }
  return dir;
}
