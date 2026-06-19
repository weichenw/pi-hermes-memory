/**
 * Normalize text the user pasted from memory_search / memory-tool output before
 * using it as a lookup key for remove/replace.
 *
 * memory_search renders entries with a leading emoji + scope tag, e.g.
 *   `🧠 [global] prefers pnpm over npm`
 *   `👤 [global] lives in Sydney`
 * and failure entries can carry a doubled tag in some render paths, e.g.
 *   `[correction] [correction] retry with --force`
 *
 * The stored entry text does NOT include those prefixes, so a raw paste would
 * never match. This strips them so remove/replace accept the pasted form.
 *
 * Multi-line pastes collapse to the first non-empty line, since memory entries
 * are single-line §-delimited records.
 */
export function normalizeMemoryLookupText(text: string): string {
  let normalized = text.trim();
  if (!normalized) return '';

  const firstNonEmptyLine = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstNonEmptyLine) normalized = firstNonEmptyLine;

  // Strip a leading emoji + scope tag, e.g. "🧠 [global] ...", "👤 [user] ..."
  normalized = normalized.replace(/^\S+\s+\[[^\]]+\]\s+/u, '');
  // Collapse a doubled leading tag like "[correction] [correction] ..." -> "[correction] ..."
  normalized = normalized.replace(/^(\[[^\]]+\])\s+\1(\s+|$)/, '$1 ');

  return normalized.trim();
}