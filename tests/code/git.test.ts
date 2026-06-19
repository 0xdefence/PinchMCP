import { describe, it, expect } from "vitest";
import { isGitRepo, gitLog, parseLog } from "../../src/code/git.js";
import { makeRepo } from "./tempRepo.js";
import { tmpdir } from "node:os";

describe("git plumbing", () => {
  it("detects a git repo and rejects a non-repo", async () => {
    const repo = makeRepo([{ message: "init", files: { "a.ts": "1" } }]);
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(tmpdir())).toBe(false);
  });

  it("returns commits with their changed files (newest first)", async () => {
    const repo = makeRepo([
      { message: "ELI-1 first", files: { "src/a.ts": "a" } },
      { message: "ELI-2 second", files: { "src/b.ts": "b", "src/c.ts": "c" } },
    ]);
    const commits = await gitLog(repo, 50);
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toContain("ELI-2");
    expect(commits[0].files.sort()).toEqual(["src/b.ts", "src/c.ts"]);
    expect(commits[1].files).toEqual(["src/a.ts"]);
  });

  it("parseLog splits the record/unit-separated format", () => {
    const out =
      "\x1eh1\x1fmsg one\x1f\nsrc/a.ts\n\x1eh2\x1fmsg two\x1f\nsrc/b.ts\nsrc/c.ts\n";
    const commits = parseLog(out);
    expect(commits).toEqual([
      { hash: "h1", message: "msg one", files: ["src/a.ts"] },
      { hash: "h2", message: "msg two", files: ["src/b.ts", "src/c.ts"] },
    ]);
  });
});
