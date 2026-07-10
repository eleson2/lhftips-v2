/**
 * Shared name-normalization helpers used by both the player matcher and the
 * player registry. Kept dependency-free so either can import it without cycles.
 */

/**
 * Fold accents/diacritics to ASCII (ä→a, ö→o, é→e, ...).
 * @param {string} s
 * @returns {string}
 */
export function foldAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normalize a player name for comparison: lowercase, strip jersey numbers,
 * fold accents, collapse whitespace.
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  if (!name) return '';
  return foldAccents(
    name
      .toLowerCase()
      .trim()
      // Remove jersey numbers (e.g., "#10 Omark" or "Omark 10")
      .replace(/#?\d+\s*/g, '')
      .replace(/\s+\d+$/, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the last name (final whitespace-delimited token) from a full name.
 * @param {string} fullName
 * @returns {string}
 */
export function getLastName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}
