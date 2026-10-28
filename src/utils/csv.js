/**
 * Escape a value for CSV (handle commas, quotes, newlines)
 */
export function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** The guesses.csv header, and the order guessToCsvRow writes fields in. */
export const CSV_COLUMNS = [
  'username', 'timestamp', 'date', 'home_team', 'away_team',
  'home_score', 'away_score', 'scorer', 'raw_text', 'post_id'
];

export const CSV_HEADER = CSV_COLUMNS.join(',');

/**
 * Build one guesses.csv row from a parsed guess.
 *
 * post_id is last so that a file written before the column existed still parses
 * by position and by name; it reads back as empty, which every caller treats as
 * "not known".
 */
export function guessToCsvRow(guess, username, timestamp, postId = null) {
  return [
    escapeCSV(username),
    escapeCSV(timestamp || ''),
    guess.date,
    escapeCSV(guess.homeTeam),
    escapeCSV(guess.awayTeam),
    guess.homeScore,
    guess.awayScore,
    escapeCSV(guess.scorer || ''),
    escapeCSV(guess.rawText),
    postId == null ? '' : String(postId)
  ].join(',');
}

/**
 * Identity of a post, by forum post id when it is known.
 *
 * The id is the forum's own primary key: one integer, monotonic, and not
 * derived from anything the board reformats. username + timestamp is the
 * fallback for rows written before the CSV carried an id — a composite key
 * whose second half goes blank whenever the board changes its date format,
 * which is exactly when two different posts start looking like one.
 */
export function postIdKey(postId) {
  return `p${postId}`;
}

export function postKey(username, timestamp) {
  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(username)}|${norm(timestamp)}`;
}

/**
 * Every key a post answers to: the id key when it has an id, and always the
 * legacy key. Both are needed at once when matching scraped posts against a CSV
 * that may predate the id column.
 */
export function postKeysOf(username, timestamp, postId = null) {
  const keys = [postKey(username, timestamp)];
  if (postId != null && postId !== '') keys.unshift(postIdKey(postId));
  return keys;
}

/**
 * Split a CSV line into fields. Returns null for comment lines and the header.
 * Deliberately simple: the only fields anything here needs are the first two,
 * which never contain a quoted comma in practice.
 */
function splitRow(line) {
  if (!line || line.startsWith('#') || line.startsWith('username,')) return null;
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

/**
 * Take apart the head of a review comment line — everything before ": ".
 *
 * Written by commentLine() in review-file.js, and read here so the two sides
 * cannot drift. Both of the optional parts may be absent in a file written by
 * an older version:
 *   "#Name: text"
 *   "#Name @2026-09-24T19:02:00: text"
 *   "#Name @2026-09-24T19:02:00 p413325: text"
 *   "#Name p413325: text"
 * The markers ([fixed]/[dismissed]) are stripped before parsing.
 *
 * @returns {{ username:string, timestamp:string|null, postId:number|null, content:string }|null}
 */
export function parseCommentHead(line) {
  if (!line || !line.startsWith('#')) return null;

  const body = line.replace(/^#(?:\[fixed\]|\[dismissed\])?/, '');
  const sep = body.indexOf(': ');
  if (sep === -1) return null;

  let head = body.slice(0, sep);
  let postId = null;
  let timestamp = null;

  const id = head.match(/\sp(\d+)$/);
  if (id) {
    postId = parseInt(id[1], 10);
    head = head.slice(0, id.index);
  }

  const at = head.lastIndexOf(' @');
  if (at !== -1) {
    const ts = head.slice(at + 2);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ts)) {
      timestamp = ts;
      head = head.slice(0, at);
    }
  }

  const username = head.trim();
  if (!username) return null;

  return { username, timestamp, postId, content: body.slice(sep + 2) };
}

/**
 * The post a line belongs to, or null if it belongs to none.
 *
 * Exactly one key per line, and the id wins when the line has one: a row that
 * names its post must not also answer to the composite key, or two posts a
 * minute apart by the same user — which share a timestamp, since the board
 * only publishes minutes — would look like one post.
 *
 * Handles data rows and review comment lines in every marked form.
 */
export function postKeyOfLine(line) {
  if (!line) return null;

  if (line.startsWith('#')) {
    const head = parseCommentHead(line);
    if (!head) return null;
    if (head.postId != null) return postIdKey(head.postId);
    if (head.timestamp === null) return null;
    return postKey(head.username, head.timestamp);
  }

  const f = splitRow(line);
  if (!f || f.length < 2) return null;
  if (f.length > 9 && f[9] !== '') return postIdKey(f[9]);
  return postKey(f[0], f[1]);
}

/**
 * Drop every line belonging to one of `keys`.
 *
 * Used when the scrape cursor is rewound: those posts are about to be written
 * again, and without this they would appear twice (the DB would dedupe on
 * UNIQUE(user_id, match_id), but the CSV would not).
 *
 * Each line offers one key; the caller passes every key its posts answer to
 * (postKeysOf), because rows already in the file may predate the post_id
 * column — the scraper knows the id, the old row knows only username and
 * timestamp, and the rewind has to recognise them as the same post.
 *
 * @param {string[]} lines
 * @param {Set<string>|string[]} keys - post keys from postKeysOf()
 * @returns {{ lines: string[], removed: number }}
 */
export function removeRowsForPosts(lines, keys) {
  const set = keys instanceof Set ? keys : new Set(keys);
  const out = [];
  let removed = 0;
  for (const line of lines) {
    const key = postKeyOfLine(line);
    if (key !== null && set.has(key)) { removed++; continue; }
    out.push(line);
  }
  return { lines: out, removed };
}
