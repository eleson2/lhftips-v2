import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as cheerio from 'cheerio';
import { parseSchedulePage } from '../src/scrapers/swehockey-scraper.js';

// Mirrors stats.swehockey.se schedule rows: 8-column fixture rows (no result
// link until played), plus a played game that carries a Game/Events link.
const HTML = `<table>
  <tr><td>2026-09-19</td><td>2026-09-1915:15</td><td>15:15</td><td>Frölunda HC - Växjö Lakers HC</td><td></td><td></td><td></td><td>Scandinavium</td></tr>
  <tr><td>18:00</td><td></td><td>18:00</td><td>Luleå HF - Rögle BK</td><td></td><td></td><td></td><td>Coop Norrbotten Arena</td></tr>
  <tr><td>2026-09-29</td><td></td><td>19:00</td><td>Skellefteå AIK - Luleå HF</td><td></td><td></td><td></td><td>Skellefteå Kraft Arena</td></tr>
  <tr><td>2025-11-01</td><td>19:00</td><td>Luleå HF - Brynäs IF</td><td><a href="/ScheduleAndResults/Game/Events/12345">5 - 2</a></td><td>(1-0, 2-1, 0-1, 2-0)</td></tr>
</table>`;

describe('parseSchedulePage', () => {
  const matches = parseSchedulePage(cheerio.load(HTML));

  test('captures only Luleå games (fixtures + played)', () => {
    assert.strictEqual(matches.length, 3);
    assert.ok(matches.every((m) => m.homeTeam === 'Luleå HF' || m.awayTeam === 'Luleå HF'));
  });

  test('loads an unplayed home fixture with null score and null game id', () => {
    const m = matches.find((x) => x.awayTeam === 'Rögle BK');
    assert.ok(m, 'Luleå–Rögle fixture present');
    assert.strictEqual(m.matchDate, '2026-09-19'); // carried from the date header row
    assert.strictEqual(m.matchTime, '18:00');
    assert.strictEqual(m.homeScore, null);
    assert.strictEqual(m.awayScore, null);
    assert.strictEqual(m.swehockeyGameId, null);
    assert.strictEqual(m.luleaIsHome, true); // Luleå is home
  });

  test('loads an unplayed away fixture with correct orientation', () => {
    const m = matches.find((x) => x.homeTeam === 'Skellefteå AIK');
    assert.ok(m);
    assert.strictEqual(m.awayTeam, 'Luleå HF');
    assert.strictEqual(m.luleaIsHome, false);
    assert.strictEqual(m.matchDate, '2026-09-29');
    assert.strictEqual(m.homeScore, null);
  });

  test('parses a played game: score, game id, and overtime', () => {
    const m = matches.find((x) => x.awayTeam === 'Brynäs IF');
    assert.ok(m);
    assert.strictEqual(m.homeScore, 5);
    assert.strictEqual(m.awayScore, 2);
    assert.strictEqual(m.swehockeyGameId, 12345);
    assert.strictEqual(m.isOvertime, true); // 4 period groups
  });

  test('does not mistake a score cell for a teams cell', () => {
    // The played row's "5 - 2" lives in its own cell; it must not create a
    // bogus match, which the length assertion above already guards.
    const bogus = matches.filter((m) => !m.homeTeam || !m.awayTeam);
    assert.strictEqual(bogus.length, 0);
  });
});
