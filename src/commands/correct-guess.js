import { existsSync, readFileSync } from 'fs';
import { parse as parseCSVLine } from 'csv-parse/sync';
import { parseGuess } from '../parsers/guess-parser.js';
import { guessToCsvRow, escapeCSV } from '../utils/csv.js';
import {
  readLines, writeLines, parseCommentLine, MARK_FIXED, MARK_DISMISSED,
} from '../utils/review-file.js';
import {
  loadCorrections, saveCorrections, setCorrection, removeCorrection,
  correctionKey, CORRECTION, getCorrectionsPath,
} from '../utils/guess-corrections.js';

/**
 * Split one CSV line into fields, or null if it isn't a data row.
 * Comment lines (# / #[fixed] / #[dismissed]) and the header are not data.
 */
function fieldsOf(line) {
  if (!line || line.startsWith('#')) return null;
  if (line.startsWith('username,')) return null;
  try {
    const rows = parseCSVLine(line, { relax_quotes: true, relax_column_count: true });
    return rows[0] || null;
  } catch {
    return null;
  }
}

/** Does this CSV line belong to the given post? (username + timestamp) */
function belongsToPost(line, username, timestamp) {
  const f = fieldsOf(line);
  if (!f) return false;
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  return norm(f[0]) === norm(username) && norm(f[1]) === norm(timestamp);
}

/** The raw_text already recorded for that post, so staleness can be judged later. */
function originalTextFor(lines, username, timestamp) {
  for (const line of lines) {
    if (!belongsToPost(line, username, timestamp)) continue;
    const f = fieldsOf(line);
    if (f && f[8]) return f[8];
  }
  return '';
}

/**
 * Is this a still-pending `#Username @timestamp: ...` review line for the post?
 * Already-handled lines (#[fixed] / #[dismissed]) are left alone.
 */
function isPendingCommentFor(line, username, timestamp) {
  const c = parseCommentLine(line);
  if (!c) return false;
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  return norm(c.username) === norm(username) && norm(c.timestamp) === norm(timestamp);
}

/**
 * Replace everything the file holds for a post with `rows` (possibly none),
 * keeping the rest byte-identical.
 *
 * A post can appear two ways: as data row(s), or as a pending `#` review line
 * when the parser gave up on it. Data rows are replaced; a `#` line is re-marked
 * `#[fixed]`/`#[dismissed]` exactly as the review UI does, so the two paths
 * leave the file in the same shape and the line never resurfaces for review.
 */
function replacePostRows(lines, username, timestamp, rows, mark) {
  const out = [];
  let inserted = false;
  for (const line of lines) {
    if (isPendingCommentFor(line, username, timestamp)) {
      out.push(mark + line.slice(1));
      if (!inserted && rows.length > 0) {
        out.push(...rows);
        inserted = true;
      }
      continue;
    }
    if (belongsToPost(line, username, timestamp)) {
      if (!inserted && rows.length > 0) {
        out.push(...rows);
        inserted = true;
      }
      continue; // drop the old row
    }
    out.push(line);
  }
  if (!inserted && rows.length > 0) out.push(...rows); // post wasn't in the file yet
  return out;
}

/**
 * Rewrite one written date to another across every row that carries it.
 *
 * The automatic repair (utils/date-repair.js) handles a typo'd year or month by
 * checking it against the schedule. What it deliberately will NOT touch is a
 * date written *before* the post, because that is ambiguous — it could be a
 * mistyped day, or a genuinely late guess that rule 2.7 disqualifies. Only a
 * person can tell those apart.
 *
 * When it is a typo, it is usually a typo several people made at once (they copy
 * each other's line, or the thread's own template was wrong), so it is fixed
 * once here rather than post by post. Every affected row still gets its own
 * durable correction record, so the fix outlives a `--fresh` re-scrape.
 *
 * @returns {{changed:number, posts:string[]}}
 */
function rewriteDateInRows(lines, writtenDate, correctedDate) {
  const out = [];
  const posts = [];
  let changed = 0;

  for (const line of lines) {
    const f = fieldsOf(line);
    if (!f || f[2] !== writtenDate) {
      out.push(line);
      continue;
    }
    const updated = f.slice();
    updated[2] = correctedDate;
    out.push(updated.map(escapeCSV).join(','));
    posts.push(`${f[0]}|${f[1]}`);
    changed++;
  }

  return { lines: out, changed, posts };
}

/**
 * Record a manual correction for one post, and apply it to the CSV now.
 *
 * This is the path for a guess that *parsed* but parsed wrongly — a typo'd date
 * that produced a valid-looking row matching no fixture, a misread score. Those
 * never become `#` lines, so the review UI never offers them; without this they
 * could only be fixed by editing the CSV by hand, and that edit would be lost
 * the next time `--fresh` regenerated the file.
 */
export async function correctGuess(action, username, timestamp, text, options = {}) {
  const { file = 'guesses.csv' } = options;
  const store = loadCorrections();

  if (action === 'list') {
    const entries = Object.entries(store.corrections || {});
    if (entries.length === 0) {
      console.log(`\nNo manual corrections recorded (${getCorrectionsPath()}).`);
      return;
    }
    console.log(`\n${entries.length} manual correction(s) — ${getCorrectionsPath()}\n`);
    for (const [key, c] of entries) {
      console.log(`  ${c.username} @${c.timestamp}  [${c.kind}]  ${c.decidedAt.slice(0, 10)}`);
      for (const r of c.rows) console.log(`      ${r}`);
      if (c.kind === CORRECTION.DISMISSED) console.log('      (no rows — treated as not a guess)');
      console.log(`      key: ${key}`);
    }
    console.log('\nThese are re-applied on every scrape, including `--fresh`.');
    return;
  }

  if (!username || !timestamp) {
    console.error(action === 'date'
      ? 'Usage: correct date <written-date> <corrected-date>'
      : 'username and timestamp are required (the post timestamp, as it appears in the CSV)');
    process.exit(1);
  }

  if (action === 'date') {
    const writtenDate = username;     // positional reuse: <written> <corrected>
    const correctedDate = timestamp;
    if (!/^\d{1,6}-\d{1,2}-\d{1,2}$/.test(writtenDate) || !/^\d{4}-\d{2}-\d{2}$/.test(correctedDate)) {
      console.error('Usage: correct date <written-date> <corrected-date>  (e.g. correct date 2023-09-08 2023-09-28)');
      process.exit(1);
    }
    if (!existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }

    const lines = readLines(file);
    const result = rewriteDateInRows(lines, writtenDate, correctedDate);

    if (result.changed === 0) {
      console.log(`\nNo rows carry the date ${writtenDate} in ${file}.`);
      return;
    }

    // One durable correction per affected post, so a --fresh re-scrape replays
    // the fix instead of regenerating the typo.
    for (const line of result.lines) {
      const f = fieldsOf(line);
      if (!f || f[2] !== correctedDate) continue;
      if (!result.posts.includes(`${f[0]}|${f[1]}`)) continue;
      setCorrection(store, {
        username: f[0], timestamp: f[1],
        kind: CORRECTION.FIXED,
        rows: [line],
        originalText: f[8] || '',
        note: options.note || `date ${writtenDate} -> ${correctedDate}`,
      });
    }
    saveCorrections(store);
    writeLines(file, result.lines);

    console.log(`\nRewrote ${writtenDate} -> ${correctedDate} on ${result.changed} row(s) in ${file}.`);
    console.log(`Saved ${result.posts.length} correction(s); they survive a --fresh re-scrape.`);
    console.log('Re-run: import guesses + calculate --force');
    return;
  }

  if (action === 'remove') {
    const key = correctionKey(username, timestamp);
    if (removeCorrection(store, key)) {
      saveCorrections(store);
      console.log(`Removed correction for ${username} @${timestamp}.`);
      console.log('The CSV is unchanged — re-scrape with --fresh to regenerate that post from the parser.');
    } else {
      console.log(`No correction recorded for ${username} @${timestamp}.`);
    }
    return;
  }

  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const lines = readLines(file);
  const originalText = originalTextFor(lines, username, timestamp);

  if (action === 'dismiss') {
    setCorrection(store, {
      username, timestamp, kind: CORRECTION.DISMISSED, originalText,
      note: options.note || '',
    });
    saveCorrections(store);
    writeLines(file, replacePostRows(lines, username, timestamp, [], MARK_DISMISSED));
    console.log(`\nDismissed ${username} @${timestamp} — rows removed from ${file}, decision saved.`);
    console.log('Re-run: import guesses + calculate --force');
    return;
  }

  // action === 'set'
  const candidates = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (candidates.length === 0) {
    console.error('Provide the corrected guess text, e.g. "2026-10-14, Luleå - Frölunda, 3-2, Brännström"');
    process.exit(1);
  }

  const defaultYear = new Date().getFullYear();
  const rows = [];
  for (const line of candidates) {
    const g = parseGuess(line, defaultYear);
    if (!g) {
      console.error(`Does not parse as a guess: "${line}"`);
      process.exit(1);
    }
    rows.push(guessToCsvRow(g, username, timestamp));
    console.log(`  ${g.date}  ${g.homeTeam} ${g.homeScore}-${g.awayScore} ${g.awayTeam}${g.scorer ? '  (' + g.scorer + ')' : ''}`);
  }

  setCorrection(store, {
    username, timestamp, kind: CORRECTION.FIXED, rows, originalText,
    note: options.note || '',
  });
  saveCorrections(store);
  writeLines(file, replacePostRows(lines, username, timestamp, rows, MARK_FIXED));

  console.log(`\nCorrected ${username} @${timestamp} — ${rows.length} row(s) written to ${file}, decision saved.`);
  console.log('It will be re-applied on every future scrape, including --fresh.');
  console.log('Re-run: import guesses + calculate --force');
}

export default correctGuess;
