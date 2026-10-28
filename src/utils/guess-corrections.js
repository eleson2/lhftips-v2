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
 * The forum post id when it is known — one integer the board never reformats.
 * username + post timestamp is the fallback, for corrections recorded from the
 * `correct` CLI (which addresses posts that way) and for everything filed
 * before the CSV carried an id. Lookups try both, so neither kind is lost.
 */
export function correctionKey(username, timestamp, postId = null) {
  if (postId != null && postId !== '') return `p${postId}`;
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
  const key = correctionKey(username, timestamp, postId);
  store.corrections[key] = record;

  // A post filed under the old composite key and now re-decided under its id
  // would otherwise be recorded twice, and the stale one would outlive the post.
  const legacy = correctionKey(username, timestamp);
  if (legacy !== key) delete store.corrections[legacy];

  return record;
}

export function removeCorrection(store, key) {
  if (!store.corrections) return false;
  if (key in store.corrections) {
    delete store.corrections[key];
    return true;
  }

  // A correction filed under its post id is still addressed as username +
  // timestamp by the `correct` CLI, which never has an id to offer. Fall back
  // to the identity recorded inside the entry rather than making the caller
  // guess which key form was used.
  for (const [k, c] of Object.entries(store.corrections)) {
    if (correctionKey(c.username, c.timestamp) === key) {
      delete store.corrections[k];
      return true;
    }
  }
  return false;
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
export function findCorrection(store, { username, timestamp, postId = null, content = null }) {
  // Id key first, then the composite one: a correction recorded before the CSV
  // carried post ids (or through the `correct` CLI) is still about this post.
  const key = correctionKey(username, timestamp, postId);
  const legacy = correctionKey(username, timestamp);

  let c = store.corrections?.[key] ?? null;
  if (!c) {
    const fallback = store.corrections?.[legacy] ?? null;
    // The composite key cannot tell two posts a minute apart by one user apart.
    // If the entry names a different post, it is not about this one — the
    // fallback is for entries that never knew an id, not a loose match.
    const aboutAnotherPost = fallback?.postId != null && postId != null && fallback.postId !== postId;
    if (fallback && !aboutAnotherPost) c = fallback;
  }
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
    postId: post.postId ?? null,
    content: post.content,
  });

  if (stale) return { rows: parsedRows, applied: false, dismissed: false, stale: true, key };
  if (!correction) return { rows: parsedRows, applied: false, dismissed: false, stale: false, key };

  if (correction.kind === CORRECTION.DISMISSED) {
    return { rows: [], applied: true, dismissed: true, stale: false, key };
  }
  return { rows: correction.rows.slice(), applied: true, dismissed: false, stale: false, key };
}
