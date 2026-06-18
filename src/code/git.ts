import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Commit } from "./types.js";

const exec = promisify(execFile);

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await exec("git", [
      "-C",
      repoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function gitLog(
  repoPath: string,
  maxCommits: number
): Promise<Commit[]> {
  // Record sep \x1e between commits; unit sep \x1f between hash | message |
  // (then --name-only appends the file list).
  const { stdout } = await exec(
    "git",
    [
      "-C",
      repoPath,
      "log",
      "--all",
      "-n",
      String(maxCommits),
      "--name-only",
      "--pretty=format:%x1e%H%x1f%B%x1f",
    ],
    { maxBuffer: 128 * 1024 * 1024 }
  );
  return parseLog(stdout);
}

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter((r) => r.trim().length > 0)
    .map((record) => {
      const [hash = "", message = "", filesBlock = ""] = record.split("\x1f");
      const files = filesBlock
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return { hash: hash.trim(), message: message.trim(), files };
    });
}
