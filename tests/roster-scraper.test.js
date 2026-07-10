import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseRosterHtml } from '../src/scrapers/roster-scraper.js';

// Mirrors the real luleahockey.se markup: <h3> position groups + <p>/<a> lines
// of " {number} {name} - {YYYY/YY} [(NY)]".
const HTML = `
<html><body>
  <div>
    <h3 class="heading">Målvakter</h3>
    <p class="paragraph text-left"> 31 Matteus Ward - 2026/27 </p>
    <p class="paragraph text-left"> 34 Joel Lassinantti - 2027/28 <br> </p>
    <h3 class="heading">Backar</h3>
    <a href="/spelare/x"> 27 Oskari Laaksonen - 2027/28 (NY)</a>
    <p class="paragraph text-left"> 29 Erik Gustafsson - 2026/27 </p>
    <h3 class="heading">Forwards</h3>
    <a href="/spelare/y"> 17 Isac Brännström - 2027/28 (NY)</a>
    <p class="paragraph text-left"> 71 Jakob Ihs-Wozniak - 2027/28 </p>
    <p class="paragraph text-left"> 91 Brian O'Neill - 2026/27 </p>
    <p class="paragraph text-left">Some unrelated paragraph without a player.</p>
  </div>
</body></html>`;

describe('parseRosterHtml', () => {
  const players = parseRosterHtml(HTML);

  test('parses every player line and ignores noise', () => {
    assert.strictEqual(players.length, 7);
  });

  test('extracts number and name', () => {
    const ward = players.find((p) => p.name === 'Matteus Ward');
    assert.strictEqual(ward.number, 31);
  });

  test('assigns position from the preceding heading', () => {
    assert.strictEqual(players.find((p) => p.name === 'Joel Lassinantti').position, 'goalie');
    assert.strictEqual(players.find((p) => p.name === 'Erik Gustafsson').position, 'defense');
    assert.strictEqual(players.find((p) => p.name === "Brian O'Neill").position, 'forward');
  });

  test('handles hyphenated surnames', () => {
    assert.ok(players.some((p) => p.name === 'Jakob Ihs-Wozniak' && p.number === 71));
  });

  test('flags (NY) as new signings', () => {
    assert.strictEqual(players.find((p) => p.name === 'Isac Brännström').isNew, true);
    assert.strictEqual(players.find((p) => p.name === 'Matteus Ward').isNew, false);
  });
});
