import { describe, it, expect } from "vitest";
import { coupleTickets } from "../../src/code/couple.js";
import { buildCoChange } from "../../src/code/coChange.js";
import { ImportGraph, TicketFiles } from "../../src/code/types.js";

const tf = (identifier: string, files: string[]): TicketFiles => ({
  issueId: identifier.toLowerCase(),
  identifier,
  files,
});
const noImports: ImportGraph = new Map();
const noCoChange = buildCoChange([]);

describe("coupleTickets", () => {
  it("suggests a link for tickets that share a file (undirected)", () => {
    const out = coupleTickets(
      [tf("ELI-1", ["src/auth.ts"]), tf("ELI-2", ["src/auth.ts"])],
      noImports,
      noCoChange
    );
    expect(out).toHaveLength(1);
    expect(out[0].sharedFiles).toBe(1);
    expect(out[0].direction).toBe("undirected");
    expect(out[0].score).toBeGreaterThan(0);
    expect(out[0].evidence.join(" ")).toMatch(/src\/auth\.ts/);
  });

  it("derives direction from import edges (A imports B => A depends on B)", () => {
    const imports: ImportGraph = new Map([
      ["src/a.ts", new Set(["src/b.ts"])],
    ]);
    const out = coupleTickets(
      [tf("ELI-1", ["src/a.ts"]), tf("ELI-2", ["src/b.ts"])],
      imports,
      noCoChange
    );
    expect(out).toHaveLength(1);
    expect(out[0].importEdges).toBe(1);
    expect(out[0].direction).toBe("a_depends_on_b");
  });

  it("uses co-change above the floor as a signal", () => {
    const coChange = buildCoChange([
      { hash: "h", message: "m", files: ["src/x.ts", "src/y.ts"] },
      { hash: "h", message: "m", files: ["src/x.ts", "src/y.ts"] },
    ]);
    const out = coupleTickets(
      [tf("ELI-1", ["src/x.ts"]), tf("ELI-2", ["src/y.ts"])],
      noImports,
      coChange
    );
    expect(out).toHaveLength(1);
    expect(out[0].coChangeWeight).toBe(2);
  });

  it("does not suggest unrelated tickets (no shared/import, co-change below floor)", () => {
    const out = coupleTickets(
      [tf("ELI-1", ["src/a.ts"]), tf("ELI-2", ["src/z.ts"])],
      noImports,
      noCoChange
    );
    expect(out).toEqual([]);
  });

  it("skips tickets with no mapped files", () => {
    const out = coupleTickets(
      [tf("ELI-1", []), tf("ELI-2", ["src/a.ts"])],
      noImports,
      noCoChange
    );
    expect(out).toEqual([]);
  });
});
