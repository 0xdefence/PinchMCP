const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is",
  "are", "be", "this", "that", "it", "as", "at", "by", "from", "into", "via",
  "add", "use", "using", "get", "set", "new", "run", "support", "feature",
  "fix", "improve", "update", "make", "build", "create", "remove",
  "src", "lib", "dist", "node", "modules", "test", "tests", "spec", "index",
  "const", "let", "var", "function", "class", "export", "import", "type",
  "interface", "enum", "return", "async", "await", "default", "string",
  "number", "boolean", "void", "null", "undefined",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}
