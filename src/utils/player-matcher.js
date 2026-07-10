import Fuse from 'fuse.js';
import { createDebugger } from './debug.js';
import { normalizeName, getLastName } from './name-normalize.js';
import { loadRegistry, buildLookup } from './player-registry.js';

const debug = createDebugger('player');

// Load the registry once and build a normalized-spelling → canonical lookup.
// A spelling that maps to more than one player is flagged AMBIGUOUS and never
// resolved via the registry — we fall back to per-game evidence instead.
let _registry = loadRegistry();
let _lookup = buildLookup(_registry);

/**
 * Reload the registry from disk (used after learning writes new variations).
 */
export function reloadRegistry() {
  _registry = loadRegistry();
  _lookup = buildLookup(_registry);
}

/**
 * Resolve a name to its canonical registry entry, or null if unknown/ambiguous.
 * @param {string} name
 * @returns {string|null}
 */
export function resolveCanonical(name) {
  const norm = normalizeName(name);
  if (!norm) return null;
  const hit = _lookup.map.get(norm);
  if (hit === undefined || hit === _lookup.AMBIGUOUS) return null;
  return hit;
}

export { normalizeName, getLastName };

/**
 * Check if two player names refer to the same player.
 * @param {string} guessedName
 * @param {string} actualName
 * @param {number} threshold - Fuse threshold (lower = stricter)
 * @returns {boolean}
 */
export function playersMatch(guessedName, actualName, threshold = 0.4) {
  return classifyMatch(guessedName, actualName, threshold).matched;
}

/**
 * Classify how two names match, returning the method and a confidence in [0,1].
 * Confidence: exact=1.0, registry=0.95, last-name=0.85, fuzzy=1-score.
 * @returns {{ matched: boolean, method: string|null, confidence: number }}
 */
export function classifyMatch(guessedName, actualName, threshold = 0.4) {
  if (!guessedName || !actualName) return { matched: false, method: null, confidence: 0 };

  const g = normalizeName(guessedName);
  const a = normalizeName(actualName);

  if (g === a) return { matched: true, method: 'exact', confidence: 1 };

  // Registry: both sides resolve to the same (unambiguous) canonical player.
  const cg = resolveCanonical(guessedName);
  const ca = resolveCanonical(actualName);
  if (cg && ca && cg === ca) return { matched: true, method: 'registry', confidence: 0.95 };

  // Last-name equality (very common — guesses often give surname only).
  const gl = getLastName(g);
  const al = getLastName(a);
  if (gl === al && gl.length >= 3) return { matched: true, method: 'lastname', confidence: 0.85 };

  // Fuzzy on the full normalized names.
  const fuse = new Fuse([a], { threshold, includeScore: true });
  const r = fuse.search(g);
  if (r.length > 0 && r[0].score < threshold) {
    return { matched: true, method: 'fuzzy', confidence: 1 - r[0].score };
  }

  // Fuzzy on last names.
  const fuseLast = new Fuse([al], { threshold, includeScore: true });
  const rl = fuseLast.search(gl);
  if (rl.length > 0 && rl[0].score < threshold) {
    return { matched: true, method: 'fuzzy-lastname', confidence: 1 - rl[0].score };
  }

  return { matched: false, method: null, confidence: 0 };
}

/**
 * Match a guessed scorer against the list of actual goalscorers for a game.
 * This is the primary, ground-truth-backed path used by scoring.
 *
 * @param {string} guessedName
 * @param {string[]} actualScorerNames - real goalscorers from swehockey
 * @returns {{
 *   matched: boolean,
 *   actualName: string|null,   // the real scorer name that matched
 *   canonical: string|null,    // registry canonical for that scorer, if known
 *   method: string|null,
 *   confidence: number,
 *   ambiguous: boolean         // matched >1 distinct actual scorer equally
 * }}
 */
export function matchScorer(guessedName, actualScorerNames) {
  const none = { matched: false, actualName: null, canonical: null, method: null, confidence: 0, ambiguous: false };
  if (!guessedName || !actualScorerNames || actualScorerNames.length === 0) return none;

  let best = null;
  let bestCount = 0;
  for (const actual of actualScorerNames) {
    const c = classifyMatch(guessedName, actual);
    if (!c.matched) continue;
    if (!best || c.confidence > best.confidence) {
      best = { ...c, actualName: actual };
      bestCount = 1;
    } else if (best && c.confidence === best.confidence && actual !== best.actualName) {
      bestCount += 1;
    }
  }

  if (!best) {
    debug(`No scorer match: "${guessedName}" vs [${actualScorerNames.join(', ')}]`);
    return none;
  }

  return {
    matched: true,
    actualName: best.actualName,
    canonical: resolveCanonical(best.actualName),
    method: best.method,
    confidence: best.confidence,
    ambiguous: bestCount > 1,
  };
}

/**
 * Find the best matching player from a list of scorers (kept for compatibility).
 * @param {string} guessedName
 * @param {string[]} scorerNames
 * @returns {{ match: string|null, score: number }}
 */
export function findBestMatch(guessedName, scorerNames) {
  if (!guessedName || !scorerNames || scorerNames.length === 0) {
    return { match: null, score: 1 };
  }

  const normalizedGuess = normalizeName(guessedName);
  const fuse = new Fuse(scorerNames.map((name) => ({ name, normalized: normalizeName(name) })), {
    keys: ['normalized'],
    threshold: 0.5,
    includeScore: true,
  });
  const results = fuse.search(normalizedGuess);
  if (results.length > 0) {
    return { match: results[0].item.name, score: results[0].score };
  }

  const guessLastName = getLastName(normalizedGuess);
  const lastNameFuse = new Fuse(
    scorerNames.map((name) => ({ name, lastName: getLastName(normalizeName(name)) })),
    { keys: ['lastName'], threshold: 0.4, includeScore: true }
  );
  const lastNameResults = lastNameFuse.search(guessLastName);
  if (lastNameResults.length > 0) {
    return { match: lastNameResults[0].item.name, score: lastNameResults[0].score };
  }

  return { match: null, score: 1 };
}
