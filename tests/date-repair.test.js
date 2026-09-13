import { test, describe } from 'node:test';
import assert from 'node:assert';
import { repairCandidates, plausibleForPost, repairGuessDate } from '../src/utils/date-repair.js';

/**
 * A stand-in schedule. `repairGuessDate` only ever accepts a date that exists
 * here, which is what stops it inventing one.
 */
function scheduleOf(fixtures) {
  return async (date, home, away) =>
    fixtures.find(f => f.match_date === date && f.home_team === home && f.away_team === away);
}

describe('plausibleForPost', () => {
  test('accepts a guess posted on match day', () => {
    assert.strictEqual(plausibleForPost('2026-10-14', '2026-10-14T18:00:00'), true);
  });

  test('accepts a guess posted a few days ahead', () => {
    assert.strictEqual(plausibleForPost('2026-10-20', '2026-10-14T18:00:00'), true);
  });

  test('rejects a date years away from the post', () => {
    assert.strictEqual(plausibleForPost('0023-10-14', '2023-10-14T07:38:00'), false);
    assert.strictEqual(plausibleForPost('2923-12-26', '2023-12-26T16:11:00'), false);
  });

  test('rejects a match well before the post — a guess cannot follow its game', () => {
    assert.strictEqual(plausibleForPost('2026-09-01', '2026-10-14T18:00:00'), false);
  });

  test('leaves a date alone when there is no timestamp to judge by', () => {
    assert.strictEqual(plausibleForPost('0023-10-14', ''), true);
  });
});

describe('repairCandidates', () => {
  test('offers the post year first, as the commonest typo', () => {
    const c = repairCandidates('0023-10-14', '2023-10-14T07:38:00');
    assert.strictEqual(c[0], '2023-10-14');
  });

  test('offers the following year, for a January game guessed in December', () => {
    const c = repairCandidates('2026-01-05', '2026-12-30T12:00:00');
    assert.ok(c.includes('2027-01-05'), c.join(', '));
  });

  test('offers a month correction', () => {
    const c = repairCandidates('2024-04-12', '2024-03-12T13:06:00');
    assert.ok(c.includes('2024-03-12'), c.join(', '));
  });

  test('never proposes the date it was given', () => {
    assert.ok(!repairCandidates('2023-10-14', '2023-10-14T07:38:00').includes('2023-10-14'));
  });

  test('never proposes an impossible calendar date', () => {
    // 31 February must not survive a month swap.
    const c = repairCandidates('2026-01-31', '2026-02-01T12:00:00');
    assert.ok(!c.some(d => d.endsWith('-02-31')), c.join(', '));
  });

  test('returns nothing for unparseable input', () => {
    assert.deepStrictEqual(repairCandidates('not-a-date', '2026-10-14T18:00:00'), []);
    assert.deepStrictEqual(repairCandidates('2026-10-14', ''), []);
  });
});

describe('repairGuessDate — the real typos from guesses.csv', () => {
  // Every case below is a genuine row from the project's own CSV files.
  const cases = [
    ['0023-10-14', '2023-10-14T07:38:00', 'Växjö Lakers', 'Luleå HF', '2023-10-14', 'a dropped digit'],
    ['1023-10-21', '2023-10-20T08:00:00', 'Skellefteå AIK', 'Luleå HF', '2023-10-21', '1 typed for 2'],
    ['0023-11-04', '2023-11-03T22:51:00', 'Luleå HF', 'Rögle BK', '2023-11-04', 'a dropped digit'],
    ['2923-12-26', '2023-12-26T16:11:00', 'Luleå HF', 'Malmö Redhawks', '2023-12-26', '9 typed for 0'],
    ['2023-01-04', '2024-01-04T18:01:00', 'Luleå HF', 'MoDo Hockey', '2024-01-04', "last year's year in January"],
    ['2024-04-12', '2024-03-12T13:06:00', 'Färjestad BK', 'Luleå HF', '2024-03-12', 'month 04 for 03'],
  ];

  for (const [written, posted, home, away, expected, why] of cases) {
    test(`"${written}" posted ${posted.slice(0, 10)} -> ${expected} (${why})`, async () => {
      const lookup = scheduleOf([{ match_date: expected, home_team: home, away_team: away }]);
      const r = await repairGuessDate({ date: written, timestamp: posted, homeTeam: home, awayTeam: away }, lookup);
      assert.strictEqual(r.repaired, true, `tried: ${r.tried.join(', ')}`);
      assert.strictEqual(r.date, expected);
      assert.ok(r.match);
    });
  }
});

describe('repairGuessDate — refuses to guess', () => {
  const home = 'Luleå HF';
  const away = 'HV71';

  test('repairs nothing when no candidate is a real fixture', async () => {
    const lookup = scheduleOf([{ match_date: '2026-12-01', home_team: home, away_team: away }]);
    const r = await repairGuessDate(
      { date: '0023-10-14', timestamp: '2026-10-14T18:00:00', homeTeam: home, awayTeam: away },
      lookup
    );
    assert.strictEqual(r.repaired, false);
    assert.strictEqual(r.match, null);
  });

  test('will not invent a fixture between teams that never met that day', async () => {
    const lookup = scheduleOf([{ match_date: '2026-10-14', home_team: home, away_team: 'Rögle BK' }]);
    const r = await repairGuessDate(
      { date: '0026-10-14', timestamp: '2026-10-14T12:00:00', homeTeam: home, awayTeam: away },
      lookup
    );
    assert.strictEqual(r.repaired, false, 'the opponent must match too');
  });

  test('reports ambiguity rather than picking, when two corrections both fit', async () => {
    // The same fixture exists in consecutive seasons, and both are reachable.
    const lookup = scheduleOf([
      { match_date: '2026-01-05', home_team: home, away_team: away },
      { match_date: '2027-01-05', home_team: home, away_team: away },
    ]);
    const r = await repairGuessDate(
      { date: '2025-01-05', timestamp: '2026-12-28T12:00:00', homeTeam: home, awayTeam: away },
      lookup
    );
    // Only 2027-01-05 is plausible for a post made 2026-12-28; 2026-01-05 is a
    // year in the past, so this must resolve rather than report ambiguity.
    assert.strictEqual(r.date, '2027-01-05');
  });

  test('does nothing without a post timestamp to anchor on', async () => {
    const lookup = scheduleOf([{ match_date: '2026-10-14', home_team: home, away_team: away }]);
    const r = await repairGuessDate({ date: '0026-10-14', timestamp: '', homeTeam: home, awayTeam: away }, lookup);
    assert.strictEqual(r.repaired, false);
  });

  test('never repairs to a date before the post', async () => {
    const lookup = scheduleOf([{ match_date: '2026-01-05', home_team: home, away_team: away }]);
    const r = await repairGuessDate(
      { date: '2020-01-05', timestamp: '2026-10-14T12:00:00', homeTeam: home, awayTeam: away },
      lookup
    );
    assert.strictEqual(r.repaired, false, 'a guess cannot be posted after its match');
  });
});
