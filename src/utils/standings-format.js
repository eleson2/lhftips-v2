/**
 * Renders competition standings as a forum-ready BBCode [table], the layout
 * past seasons' threads used (Swedish headers).
 *
 * A [code] block was tried and reads badly on the board: it relies on the
 * viewer's monospace font and wraps on narrow screens. [table] is laid out by
 * the forum itself, so the columns line up wherever it is read.
 *
 * Pure and dependency-free so it can be unit-tested and previewed without a DB.
 */

// Column order + headers mirror the 2022-23 standings post.
const COLUMNS = [
  { key: 'rank', header: 'Pl', align: 'right' },
  { key: 'name', header: 'Namn', align: 'left' },
  { key: 'points', header: 'Poäng', align: 'right' },
  { key: 'last', header: 'Senast', align: 'right' },
  { key: 'rounds', header: 'Omg', align: 'right' },
  { key: 'full', header: 'Full', align: 'right' },
  { key: 'ppg', header: 'PPG', align: 'right' },
  { key: 'scorers', header: 'Målsk', align: 'right' },
  { key: 'results', header: 'Result', align: 'right' },
];

// Cells per source line. The BBCode is identical whether a row is one long
// line or several — this keeps a row readable in the editor and in a diff.
const CELLS_PER_LINE = 3;

/**
 * PPG the way the thread has always shown it: two decimals, but a trailing
 * zero trimmed, so whole and half values read "4.0" and "3.5", not "4.00".
 */
export function formatPPG(value) {
  const fixed = Number(value).toFixed(2);
  return fixed.endsWith('0') ? fixed.slice(0, -1) : fixed;
}

/** One [tr]...[/tr], its cells wrapped across lines. */
function row(cells) {
  const tagged = cells.map((c) => `[td]${c}[/td]`);
  const lines = [];
  for (let i = 0; i < tagged.length; i += CELLS_PER_LINE) {
    lines.push(tagged.slice(i, i + CELLS_PER_LINE).join(''));
  }
  lines[0] = `[tr]${lines[0]}`;
  lines[lines.length - 1] += '[/tr]';
  return lines;
}

/**
 * @param {object} args
 * @param {Array<{rank?:number,name:string,points:number,last_round?:number|null,rounds:number,full:number,ppg:number,scorers:number,results:number}>} args.rows
 * @param {Array<{name:string,date:string,matchLabel:string,scorer?:string}>} [args.perfect]
 * @param {{roundLabel?:string,date?:string}} [args.meta]
 * @returns {string} forum-ready BBCode text
 */
export function renderStandings({ rows, perfect = [], meta = {} }) {
  const display = rows.map((r, i) => ({
    rank: r.rank ?? i + 1,
    name: r.name,
    points: r.points,
    last: r.last_round ?? '-',
    rounds: r.rounds,
    full: r.full,
    ppg: formatPPG(r.ppg),
    scorers: r.scorers,
    results: r.results,
  }));

  const datePart = meta.date ? ` (${meta.date})` : '';
  const title = meta.roundLabel
    ? `[b]Ställning i tipstävlingen efter ${meta.roundLabel}${datePart}[/b]`
    : `[b]Ställning i tipstävlingen${datePart}[/b]`;

  const out = [title, '', '[table]'];
  out.push(...row(COLUMNS.map((c) => `[b]${c.header}[/b]`)));
  for (const d of display) {
    out.push('');
    out.push(...row(COLUMNS.map((c) => d[c.key])));
  }
  out.push('[/table]');

  if (perfect.length > 0) {
    out.push('', '[b]Fullpoängare[/b] (7 poäng på en match):');
    for (const p of perfect) {
      out.push(`- ${p.name} — ${p.date} ${p.matchLabel}${p.scorer ? `, ${p.scorer}` : ''}`);
    }
  }

  return out.join('\n');
}

export { COLUMNS };
