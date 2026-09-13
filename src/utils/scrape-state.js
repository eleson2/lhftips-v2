import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATE_PATH = join(__dirname, '../../data/scrape-state.json');

/**
 * Extract the forum thread id from a thread URL, e.g.
 * ".../t2964-tipstavling-..." -> "2964". Used to key the cursor per-thread
 * so switching seasons (a new thread) doesn't reuse a stale cursor.
 */
export function extractThreadId(url) {
  const match = url && url.match(/\/t(\d+)/);
  return match ? match[1] : null;
}

function loadAllState(path = STATE_PATH) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    console.error(`Warning: could not read scrape state (${path}): ${error.message}`);
    return {};
  }
}

/**
 * Load the saved scrape cursor for a forum thread.
 * @param {string} forumUrl
 * @returns {{ forumUrl: string, lastPostId: number, lastPage: number, updatedAt: string }|null}
 */
export function loadScrapeState(forumUrl, path = STATE_PATH) {
  const threadId = extractThreadId(forumUrl);
  if (!threadId) return null;
  const all = loadAllState(path);
  return all[threadId] || null;
}

/**
 * Set the cursor to an exact position, allowing it to move BACKWARDS.
 *
 * `saveScrapeState` deliberately only ever advances, so a scrape can never lose
 * ground by accident. Rewinding is the opposite: a explicit, deliberate act
 * ("re-read everything from post 4711 on"), so it gets its own function rather
 * than a flag on the safe one.
 *
 * @param {string} forumUrl
 * @param {{lastPostId:number, lastPage?:number}} position
 * @returns {{lastPostId:number, lastPage:number}|null} the cursor as it now stands
 */
export function setScrapeState(forumUrl, { lastPostId, lastPage = 1 }, path = STATE_PATH) {
  const threadId = extractThreadId(forumUrl);
  if (!threadId) return null;

  const all = loadAllState(path);
  all[threadId] = {
    forumUrl,
    lastPostId: Math.max(0, Math.trunc(lastPostId ?? 0)),
    lastPage: Math.max(1, Math.trunc(lastPage ?? 1)),
    updatedAt: new Date().toISOString()
  };
  writeFileSync(path, JSON.stringify(all, null, 2));
  return { lastPostId: all[threadId].lastPostId, lastPage: all[threadId].lastPage };
}

/**
 * Forget the cursor for a thread entirely — the next scrape starts from page 1
 * as if the thread had never been read.
 * @returns {boolean} true if there was one to forget
 */
export function clearScrapeState(forumUrl, path = STATE_PATH) {
  const threadId = extractThreadId(forumUrl);
  if (!threadId) return false;
  const all = loadAllState(path);
  if (!(threadId in all)) return false;
  delete all[threadId];
  writeFileSync(path, JSON.stringify(all, null, 2));
  return true;
}

/**
 * Save/advance the scrape cursor for a forum thread. lastPostId only ever
 * moves forward (never regresses, even if called with a smaller value).
 */
export function saveScrapeState(forumUrl, { lastPostId, lastPage }, path = STATE_PATH) {
  const threadId = extractThreadId(forumUrl);
  if (!threadId) return;

  const all = loadAllState(path);
  const existing = all[threadId] || {};

  all[threadId] = {
    forumUrl,
    lastPostId: Math.max(lastPostId ?? 0, existing.lastPostId ?? 0),
    lastPage: lastPage ?? existing.lastPage ?? 1,
    updatedAt: new Date().toISOString()
  };

  writeFileSync(path, JSON.stringify(all, null, 2));
}
