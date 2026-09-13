import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizeName } from './name-normalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERDICTS_PATH = join(__dirname, '..', '..', 'data', 'scorer-verdicts.json');

export function getVerdictsPath() {
  return VERDICTS_PATH;
}

/** The two directions a human verdict can take. */
export const VERDICT = {
  CORRECT: 'correct',     // award the scorer point regardless of what the matcher thinks
  INCORRECT: 'incorrect', // withhold the scorer point regardless of what the matcher thinks
};

/**
 * @typedef {Object} ScorerVerdict
 * @property {string} username
 * @property {string} date          match_date (YYYY-MM-DD)
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {string} guessedScorer the spelling the verdict was decided about
 * @property {'correct'|'incorrect'} verdict
 * @property {string|null} resolvedTo canonical player the nickname meant, if known
 * @property {string} note          why — free text, shown in the review UI
 * @property {string} decidedAt     ISO timestamp
 * @property {object|null} ai       the AI suggestion that was on screen when decided
 */

/**
 * Natural key for a verdict: the same (user, match) pair that `guesses` is
 * UNIQUE on. Deliberately NOT guesses.id — that is an autoincrement column and
 * is not stable across a re-import, whereas a verdict must outlive a DB rebuild.
 * @param {{username:string, date:string, homeTeam:string, awayTeam:string}} parts
 * @returns {string}
 */
export function verdictKey({ username, date, homeTeam, awayTeam }) {
  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return [norm(username), norm(date), norm(homeTeam), norm(awayTeam)].join('|');
}

/**
 * Load the verdict store. Returns an empty shell if the file does not exist.
 * @returns {{ version: number, verdicts: Record<string, ScorerVerdict> }}
 */
export function loadVerdicts() {
  if (!existsSync(VERDICTS_PATH)) return { version: 1, verdicts: {} };
  try {
    const raw = JSON.parse(readFileSync(VERDICTS_PATH, 'utf-8'));
    return { version: raw.version ?? 1, verdicts: raw.verdicts ?? {} };
  } catch (error) {
    console.error(`Warning: could not read verdicts ${VERDICTS_PATH}: ${error.message}`);
    return { version: 1, verdicts: {} };
  }
}

/** Save with keys sorted, so the file diffs cleanly in git. */
export function saveVerdicts(store) {
  const sorted = {};
  for (const k of Object.keys(store.verdicts || {}).sort()) sorted[k] = store.verdicts[k];
  writeFileSync(VERDICTS_PATH, JSON.stringify({ version: store.version ?? 1, verdicts: sorted }, null, 2) + '\n');
}

/**
 * Record (or replace) a human verdict.
 * @returns {ScorerVerdict} the stored record
 */
export function setVerdict(store, { username, date, homeTeam, awayTeam, guessedScorer, verdict, resolvedTo = null, note = '', ai = null }) {
  if (verdict !== VERDICT.CORRECT && verdict !== VERDICT.INCORRECT) {
    throw new Error(`Unknown verdict "${verdict}" — expected "${VERDICT.CORRECT}" or "${VERDICT.INCORRECT}"`);
  }
  const key = verdictKey({ username, date, homeTeam, awayTeam });
  const record = {
    username, date, homeTeam, awayTeam,
    guessedScorer: guessedScorer ?? '',
    verdict,
    resolvedTo,
    note,
    decidedAt: new Date().toISOString(),
    ai,
  };
  store.verdicts = store.verdicts || {};
  store.verdicts[key] = record;
  return record;
}

/** Remove a verdict. @returns {boolean} true if one was there. */
export function removeVerdict(store, key) {
  if (!store.verdicts || !(key in store.verdicts)) return false;
  delete store.verdicts[key];
  return true;
}

/**
 * Look up the verdict for a guess.
 *
 * A verdict is tied to the *spelling* it was decided about. If the user later
 * edits that guess to name a different player, the old verdict must not silently
 * carry over — it comes back `stale`, is not applied, and is re-surfaced for
 * review instead.
 *
 * @param {object} store
 * @param {{username:string, date:string, homeTeam:string, awayTeam:string, guessedScorer:string}} lookup
 * @returns {{ key:string, verdict:ScorerVerdict|null, stale:boolean }}
 */
export function findVerdict(store, { username, date, homeTeam, awayTeam, guessedScorer }) {
  const key = verdictKey({ username, date, homeTeam, awayTeam });
  const v = store.verdicts?.[key] ?? null;
  if (!v) return { key, verdict: null, stale: false };
  const stale = normalizeName(v.guessedScorer) !== normalizeName(guessedScorer ?? '');
  return { key, verdict: stale ? null : v, stale };
}

/**
 * The scorer override to hand to `calculateScore`, derived from a verdict.
 * @returns {'correct'|'incorrect'|null}
 */
export function verdictOverride(verdict) {
  return verdict ? verdict.verdict : null;
}
