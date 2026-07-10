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
