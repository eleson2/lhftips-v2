import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderStandings, formatPPG, COLUMNS } from '../src/utils/standings-format.js';

const rows = [
  { name: 'Metheuz', points: 57, rounds: 40, full: 1, ppg: 1.43, scorers: 8, results: 4 },
  { name: 'NallePhu', points: 53, rounds: 39, full: 0, ppg: 1.36, scorers: 13, results: 1 },
  { name: 'Bamsefar', points: 48, rounds: 39, full: 0, ppg: 1.23, scorers: 4, results: 3 },
];

describe('renderStandings', () => {
  const out = renderStandings({
    rows,
    perfect: [{ name: 'Metheuz', date: '2026-11-15', matchLabel: 'Luleå HF 3-1 Rögle BK', scorer: 'Brännström' }],
    meta: { roundLabel: 'omgång 12', date: '2026-11-15' },
  });
  const lines = out.split('\n');

  test('wraps the table in a [table] block with a bold title', () => {
    assert.ok(out.includes('[b]Ställning i tipstävlingen efter omgång 12 (2026-11-15)[/b]'));
    assert.ok(out.includes('[table]'));
    assert.ok(out.includes('[/table]'));
    // The [code] block it replaced depended on the reader's monospace font.
    assert.ok(!out.includes('[code]'));
  });

  test('heads every column, in bold', () => {
    const header = lines.slice(lines.indexOf('[table]') + 1, lines.indexOf('[table]') + 4).join('');
    for (const c of COLUMNS) assert.ok(header.includes(`[td][b]${c.header}[/b][/td]`), c.header);
    assert.ok(header.startsWith('[tr]') && header.endsWith('[/tr]'));
  });

  test('auto-numbers ranks in points order', () => {
    const rowsOut = out.split('[tr]').slice(2); // 0 = preamble, 1 = header row
    assert.ok(rowsOut[0].includes('[td]1[/td][td]Metheuz[/td][td]57[/td]'));
    assert.ok(rowsOut[1].includes('[td]2[/td][td]NallePhu[/td][td]53[/td]'));
    assert.ok(rowsOut[2].includes('[td]3[/td][td]Bamsefar[/td][td]48[/td]'));
  });

  test('every row is a closed [tr] with one cell per column', () => {
    assert.strictEqual((out.match(/\[tr\]/g) || []).length, rows.length + 1);
    assert.strictEqual((out.match(/\[\/tr\]/g) || []).length, rows.length + 1);
    assert.strictEqual((out.match(/\[td\]/g) || []).length, (rows.length + 1) * COLUMNS.length);
  });

  test('trims a trailing zero from PPG, as the thread has always shown it', () => {
    assert.strictEqual(formatPPG(4), '4.0');
    assert.strictEqual(formatPPG(3.5), '3.5');
    assert.strictEqual(formatPPG(1.43), '1.43');
    assert.strictEqual(formatPPG(0), '0.0');
    assert.ok(out.includes('[td]1.43[/td]'));
  });

  test('renders the Fullpoängare section', () => {
    assert.ok(out.includes('[b]Fullpoängare[/b]'));
    assert.ok(out.includes('- Metheuz — 2026-11-15 Luleå HF 3-1 Rögle BK, Brännström'));
  });

  test('omits Fullpoängare section when there are none', () => {
    const noneOut = renderStandings({ rows, perfect: [], meta: {} });
    assert.ok(!noneOut.includes('Fullpoängare'));
  });
});
