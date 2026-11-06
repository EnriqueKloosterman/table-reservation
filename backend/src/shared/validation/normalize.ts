/** Canonical form of an email address: trimmed and lowercased. */
export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/** Display form of a name: trimmed, case kept as entered. */
export function normalizeName(s: string): string {
  return s.trim();
}

/** Comparison key of a name: trimmed and lowercased. */
export function nameKey(s: string): string {
  return normalizeName(s).toLowerCase();
}
