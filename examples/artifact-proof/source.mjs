/** Minimal source used only by the GitHub artifact provenance demonstration. */
export function normalizeWords(value) {
  if (typeof value !== "string") throw new TypeError("expected text");
  return value.trim().replace(/\s+/g, " ");
}

export function wordCount(value) {
  const normalized = normalizeWords(value);
  return normalized ? normalized.split(" ").length : 0;
}
