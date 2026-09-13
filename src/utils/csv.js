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

/**
 * Build one guesses.csv row (username,timestamp,date,home_team,away_team,
 * home_score,away_score,scorer,raw_text) from a parsed guess.
 */
export function guessToCsvRow(guess, username, timestamp) {
  return [
    escapeCSV(username),
    escapeCSV(timestamp || ''),
    guess.date,
    escapeCSV(guess.homeTeam),
    escapeCSV(guess.awayTeam),
    guess.homeScore,
    guess.awayScore,
    escapeCSV(guess.scorer || ''),
    escapeCSV(guess.rawText)
  ].join(',');
}

/**
 * Identity of the post a CSV line came from: username + post timestamp.
 * The same key the correction store uses, so the two agree about what "a post"
 * means.
 */
export function postKey(username, timestamp) {
  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(username)}|${norm(timestamp)}`;
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
 * The post a line belongs to, or null if it belongs to none.
 * Handles data rows and review comment lines in every marked form
 * (`#Name @ts: ...`, `#[fixed]Name @ts: ...`, `#[dismissed]Name @ts: ...`).
 */
export function postKeyOfLine(line) {
  if (!line) return null;

  if (line.startsWith('#')) {
    const body = line.replace(/^#(?:\[fixed\]|\[dismissed\])?/, '');
    const sep = body.indexOf(': ');
    if (sep === -1) return null;
    const head = body.slice(0, sep);
    const at = head.lastIndexOf(' @');
    if (at === -1) return null;
    return postKey(head.slice(0, at), head.slice(at + 2));
  }

  const f = splitRow(line);
  if (!f || f.length < 2) return null;
  return postKey(f[0], f[1]);
}

/**
 * Drop every line belonging to one of `keys`.
 *
 * Used when the scrape cursor is rewound: those posts are about to be written
 * again, and without this they would appear twice (the DB would dedupe on
 * UNIQUE(user_id, match_id), but the CSV would not).
 *
 * @param {string[]} lines
 * @param {Set<string>|string[]} keys - post keys from postKey()
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
