/**
 * Renders competition standings as a forum-ready monospace [code] block,
 * matching the layout used in past seasons' threads (Swedish headers).
 *
 * Pure and dependency-free so it can be unit-tested and previewed without a DB.
 */

// Column order + headers mirror the 2022-23 standings post.
const COLUMNS = [
  { key: 'rank', header: 'Pl', align: 'right' },
  { key: 'name', header: 'Namn', align: 'left' },
  { key: 'points', header: 'Poäng', align: 'right' },
  { key: 'rounds', header: 'Omg', align: 'right' },
  { key: 'full', header: 'Full', align: 'right' },
  { key: 'ppg', header: 'PPG', align: 'right' },
  { key: 'scorers', header: 'Målsk', align: 'right' },
  { key: 'results', header: 'Result', align: 'right' },
];

function pad(value, width, align) {
  const s = String(value);
  const gap = width - s.length;
  if (gap <= 0) return s;
  return align === 'right' ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}

/**
 * @param {object} args
 * @param {Array<{rank?:number,name:string,points:number,rounds:number,full:number,ppg:number,scorers:number,results:number}>} args.rows
 * @param {Array<{name:string,date:string,matchLabel:string,scorer?:string}>} [args.perfect]
 * @param {{roundLabel?:string,date?:string}} [args.meta]
 * @returns {string} forum-ready BBCode text
 */
export function renderStandings({ rows, perfect = [], meta = {} }) {
  const display = rows.map((r, i) => ({
    rank: r.rank ?? i + 1,
    name: r.name,
    points: r.points,
    rounds: r.rounds,
    full: r.full,
    ppg: Number(r.ppg).toFixed(2),
    scorers: r.scorers,
    results: r.results,
  }));

  const widths = {};
  for (const c of COLUMNS) {
    widths[c.key] = Math.max(c.header.length, ...display.map((d) => String(d[c.key]).length));
  }

  const line = (get) => COLUMNS.map((c) => pad(get(c), widths[c.key], c.align)).join('  ');
  const headerLine = line((c) => c.header);
  const rowLines = display.map((d) => line((c) => d[c.key]));

  const datePart = meta.date ? ` (${meta.date})` : '';
  const title = meta.roundLabel
    ? `[b]Ställning i tipstävlingen efter ${meta.roundLabel}${datePart}[/b]`
    : `[b]Ställning i tipstävlingen${datePart}[/b]`;

  const out = [title, '[code]', headerLine, ...rowLines, '[/code]'];

  if (perfect.length > 0) {
    out.push('', '[b]Fullpoängare[/b] (7 poäng på en match):');
    for (const p of perfect) {
      out.push(`- ${p.name} — ${p.date} ${p.matchLabel}${p.scorer ? `, ${p.scorer}` : ''}`);
    }
  }

  return out.join('\n');
}

export { COLUMNS };
