import { IssueSource, ProjectSummary } from "./source.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A Linear project URL slug ends in a hex suffix, e.g. "0xdefend-a1b2c3d4e5f6".
const SLUG_RE = /-[0-9a-f]{8,}$/i;

/**
 * Resolve a user-supplied project reference (name, URL slug, or UUID) to a
 * canonical project id that Linear's `project(id:)` accepts. A UUID passes
 * through without a network call; anything else is matched against the
 * workspace's projects by id, slug, then name (exact, then substring).
 */
export async function resolveProjectId(
  source: IssueSource,
  input: string
): Promise<string> {
  const q = input.trim();
  if (!q) throw new Error("Empty project reference.");
  if (UUID_RE.test(q)) return q;

  const projects = await source.listProjects();

  // Exact id or slug match.
  const exact = projects.find((p) => p.id === q || p.slugId === q);
  if (exact) return exact.id;

  // Case-insensitive name match: exact first, then substring.
  const lower = q.toLowerCase();
  const exactName = projects.filter((p) => p.name.toLowerCase() === lower);
  if (exactName.length === 1) return exactName[0].id;
  if (exactName.length > 1) throw ambiguous(q, exactName);

  const partial = projects.filter((p) => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0].id;
  if (partial.length > 1) throw ambiguous(q, partial);

  // Looks like a slug we simply didn't find in the list — let Linear decide.
  if (SLUG_RE.test(q)) return q;

  const names = projects.map((p) => `"${p.name}"`).join(", ") || "(none)";
  throw new Error(
    `No Linear project matches "${q}". Available: ${names}. Pass a project name, URL slug, or UUID.`
  );
}

function ambiguous(q: string, matches: ProjectSummary[]): Error {
  const list = matches.map((p) => `"${p.name}" (${p.id})`).join(", ");
  return new Error(
    `"${q}" matches multiple projects: ${list}. Use a more specific name, the URL slug, or the UUID.`
  );
}
