import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CORRECTIONS_PATH = join(__dirname, '..', '..', 'data', 'guess-corrections.json');

export function getCorrectionsPath() {
  return CORRECTIONS_PATH;
}

/** What a correction says should happen to a post. */
export const CORRECTION = {
  FIXED: 'fixed',         // the parser was wrong or gave up — use these rows instead
  DISMISSED: 'dismissed', // not a guess at all — emit nothing for this post
};

/**
 * @typedef {Object} GuessCorrection
 * @property {string} username
 * @property {string} timestamp      post timestamp (the other half of the key)
 * @property {number|null} postId    forum post id, when it was known
 * @property {'fixed'|'dismissed'} kind
 * @property {string[]} rows         corrected guesses.csv rows (empty when dismissed)
 * @property {string} originalText   what the post said when the call was made
 * @property {string} note
 * @property {string} decidedAt
 */

/**
 * Natural key for a correction: the post it is about.
 *
 * Post *id* would be the obvious key, but the review UI works from the CSV,
 * which never carried one — username + post timestamp is the identity available
 * on both sides (the scraper has it, the CSV has it), so that is the key. The
 * post id is recorded alongside when known, for tracing.
 */
export function correctionKey(username, timestamp) {
  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(username)}|${norm(timestamp)}`;
}

/** Compare post text loosely — whitespace and case are not a real change. */
function sameText(a, b) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

/** @returns {{ version:number, corrections:Record<string,GuessCorrection> }} */
export function loadCorrections(path = CORRECTIONS_PATH) {
  if (!existsSync(path)) return { version: 1, corrections: {} };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return { version: raw.version ?? 1, corrections: raw.corrections ?? {} };
  } catch (error) {
    console.error(`Warning: could not read corrections ${path}: ${error.message}`);
    return { version: 1, corrections: {} };
  }
}

/** Save with keys sorted so the file diffs cleanly in git. */
export function saveCorrections(store, path = CORRECTIONS_PATH) {
  const sorted = {};
  for (const k of Object.keys(store.corrections || {}).sort()) sorted[k] = store.corrections[k];
  writeFileSync(path, JSON.stringify({ version: store.version ?? 1, corrections: sorted }, null, 2) + '\n');
}

/**
 * Record a correction for one post.
 * @returns {GuessCorrection}
 */
export function setCorrection(store, { username, timestamp, postId = null, kind, rows = [], originalText = '', note = '' }) {
  if (kind !== CORRECTION.FIXED && kind !== CORRECTION.DISMISSED) {
    throw new Error(`Unknown correction kind "${kind}" — expected "${CORRECTION.FIXED}" or "${CORRECTION.DISMISSED}"`);
  }
  if (kind === CORRECTION.FIXED && rows.length === 0) {
    throw new Error('A "fixed" correction needs at least one replacement row');
  }
  const record = {
    username, timestamp, postId,
    kind,
    rows: kind === CORRECTION.DISMISSED ? [] : rows,
    originalText,
    note,
    decidedAt: new Date().toISOString(),
  };
  store.corrections = store.corrections || {};
  store.corrections[correctionKey(username, timestamp)] = record;
  return record;
}

export function removeCorrection(store, key) {
  if (!store.corrections || !(key in store.corrections)) return false;
  delete store.corrections[key];
  return true;
}

/**
 * Look up the correction for a post.
 *
 * Like a scorer verdict, a correction is tied to the text it was made about. If
 * the poster later edits their post, the old ruling must not silently stand for
 * different content — it comes back `stale`, is not applied, and is reported.
 *
 * @returns {{ key:string, correction:GuessCorrection|null, stale:boolean }}
 */
export function findCorrection(store, { username, timestamp, content = null }) {
  const key = correctionKey(username, timestamp);
  const c = store.corrections?.[key] ?? null;
  if (!c) return { key, correction: null, stale: false };

  // Only judge staleness when we actually have the post text to compare and a
  // snapshot to compare it against.
  if (content !== null && c.originalText) {
    const stale = !sameText(c.originalText, content);
    if (stale) return { key, correction: null, stale: true };
  }
  return { key, correction: c, stale: false };
}

/**
 * Apply recorded corrections while turning scraped posts into CSV rows.
 *
 * This is what makes a manual fix outlive `--fresh`. A full re-scrape discards
 * the CSV and regenerates it from the thread; without this, every hand-made fix
 * in that file would be silently thrown away — and `--fresh` is exactly what you
 * run after improving the parser, which is when you most want to keep them.
 *
 * @param {{username:string, timestamp:string, content:string, postId:number|null}} post
 * @param {string[]} parsedRows  rows the parser produced (may be empty)
 * @param {object} store
 * @returns {{ rows:string[], applied:boolean, dismissed:boolean, stale:boolean, key:string }}
 */
export function applyCorrection(post, parsedRows, store) {
  const { key, correction, stale } = findCorrection(store, {
    username: post.username,
    timestamp: post.timestamp,
    content: post.content,
  });

  if (stale) return { rows: parsedRows, applied: false, dismissed: false, stale: true, key };
  if (!correction) return { rows: parsedRows, applied: false, dismissed: false, stale: false, key };

  if (correction.kind === CORRECTION.DISMISSED) {
    return { rows: [], applied: true, dismissed: true, stale: false, key };
  }
  return { rows: correction.rows.slice(), applied: true, dismissed: false, stale: false, key };
}
