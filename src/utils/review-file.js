import { readFileSync, writeFileSync } from 'fs';
import { isSponsoredUsername } from '../scrapers/forum-scraper.js';
import { parseCommentHead } from './csv.js';

// Handled comment lines keep their leading '#' so `import guesses` still
// treats them as comments; the marker records the review decision in-file.
export const MARK_FIXED = '#[fixed]';
export const MARK_DISMISSED = '#[dismissed]';

/**
 * Write the review-comment line for a post the parser could not read.
 *
 * The timestamp is carried so a manual fix keeps the posted-before-match check
 * meaningful; the post id so the correction that comes out of the review is
 * filed against the forum's own identifier rather than a name and a date the
 * board may render differently tomorrow.
 *
 * Shape: "#Username @2026-09-24T19:02:00 p413325: content"
 */
export function commentLine(username, timestamp, postId, content) {
  const ts = timestamp ? ` @${timestamp}` : '';
  const id = postId == null ? '' : ` p${postId}`;
  return `#${username}${ts}${id}: ${String(content).replace(/\s*\n\s*/g, ' ')}`;
}

/**
 * Parse an unhandled review-comment line.
 * Formats: "#Username: content"  (legacy)
 *          "#Username @2026-09-19T18:00:00: content"
 *          "#Username @2026-09-19T18:00:00 p413325: content"
 * Returns null for non-comment lines and already-handled ([fixed]/[dismissed]) lines.
 */
export function parseCommentLine(line) {
  if (!line || !line.startsWith('#')) return null;
  if (line.startsWith(MARK_FIXED) || line.startsWith(MARK_DISMISSED)) return null;

  return parseCommentHead(line);
}

/**
 * List all pending (unhandled) review items in the file's lines.
 * Sponsored/ad placeholder posts in old files are excluded.
 * @returns {{ index: number, line: string, username: string, timestamp: string|null, content: string }[]}
 */
export function listPending(lines) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseCommentLine(lines[i]);
    if (!parsed) continue;
    if (isSponsoredUsername(parsed.username)) continue;
    items.push({ index: i, line: lines[i], ...parsed });
  }
  return items;
}

function assertUnchanged(lines, index, expectLine) {
  if (lines[index] !== expectLine) {
    throw new Error(`Line ${index + 1} has changed since it was loaded — reload and retry`);
  }
}

/**
 * Mark a comment line as fixed and insert the corrected CSV row(s) directly
 * below it. Returns a new lines array (input is not mutated).
 */
export function applyFix(lines, index, expectLine, rows) {
  assertUnchanged(lines, index, expectLine);
  const out = lines.slice();
  out[index] = MARK_FIXED + expectLine.slice(1);
  out.splice(index + 1, 0, ...rows);
  return out;
}

/**
 * Mark a comment line as dismissed (noise/chatter — no row to insert).
 * Returns a new lines array (input is not mutated).
 */
export function applyDismiss(lines, index, expectLine) {
  assertUnchanged(lines, index, expectLine);
  const out = lines.slice();
  out[index] = MARK_DISMISSED + expectLine.slice(1);
  return out;
}

/** Read a guesses CSV into lines (tolerates CRLF; rejoined with LF on save). */
export function readLines(path) {
  return readFileSync(path, 'utf-8').split(/\r?\n/);
}

export function writeLines(path, lines) {
  writeFileSync(path, lines.join('\n'));
}
