import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderStandings } from '../src/utils/standings-format.js';

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

  test('wraps the table in a [code] block with a bold title', () => {
    assert.ok(out.includes('[b]Ställning i tipstävlingen efter omgång 12 (2026-11-15)[/b]'));
    assert.ok(out.includes('[code]'));
    assert.ok(out.includes('[/code]'));
  });

  test('auto-numbers ranks in points order', () => {
    const body = lines.slice(lines.indexOf('[code]') + 2, lines.indexOf('[/code]'));
    assert.ok(body[0].trimStart().startsWith('1'));
    assert.ok(body[0].includes('Metheuz'));
    assert.ok(body[2].includes('Bamsefar'));
  });

  test('columns are monospace-aligned (equal line lengths)', () => {
    const header = lines[lines.indexOf('[code]') + 1];
    const firstRow = lines[lines.indexOf('[code]') + 2];
    assert.strictEqual(header.length, firstRow.length);
    assert.ok(header.includes('Poäng') && header.includes('Målsk') && header.includes('Result'));
  });

  test('formats PPG to two decimals', () => {
    assert.ok(out.includes('1.43'));
    assert.ok(out.includes('1.40') === false); // sanity: no accidental reformatting of 1.4
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
