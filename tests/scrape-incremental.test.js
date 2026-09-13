import { test, describe } from 'node:test';
import assert from 'node:assert';
import { needsGoalscorerFetch } from '../src/commands/scrape-results.js';
import {
  extractThreadId, saveScrapeState, loadScrapeState, setScrapeState, clearScrapeState,
} from '../src/utils/scrape-state.js';
import { postKey, postKeyOfLine, removeRowsForPosts } from '../src/utils/csv.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

const played = { swehockeyGameId: 8001, homeScore: 3, awayScore: 1, isOvertime: 0 };
const storedSame = { home_score: 3, away_score: 1, is_overtime: 0 };

describe('needsGoalscorerFetch — not re-reading games we already have', () => {
  test('fetches a played game we have never seen', () => {
    assert.strictEqual(needsGoalscorerFetch(played, null, 0), true);
  });

  test('fetches a played game we hold no goalscorers for', () => {
    assert.strictEqual(needsGoalscorerFetch(played, storedSame, 0), true);
  });

  test('SKIPS a played game whose goals we hold and whose score has not moved', () => {
    assert.strictEqual(needsGoalscorerFetch(played, storedSame, 3), false);
  });

  test('skips a game that has not been played yet', () => {
    const unplayed = { swehockeyGameId: 8003, homeScore: null, awayScore: null, isOvertime: 0 };
    assert.strictEqual(needsGoalscorerFetch(unplayed, null, 0), false);
  });

  test('skips a row with no swehockey game id to fetch by', () => {
    assert.strictEqual(needsGoalscorerFetch({ ...played, swehockeyGameId: null }, null, 0), false);
  });

  test('re-fetches when the score was corrected after we stored it', () => {
    assert.strictEqual(needsGoalscorerFetch(played, { home_score: 3, away_score: 2, is_overtime: 0 }, 3), true);
    assert.strictEqual(needsGoalscorerFetch(played, { home_score: 2, away_score: 1, is_overtime: 0 }, 3), true);
  });

  test('re-fetches when a result turns out to have gone to overtime', () => {
    assert.strictEqual(
      needsGoalscorerFetch({ ...played, isOvertime: 1 }, storedSame, 3),
      true,
      'an OT correction changes which goal was decisive'
    );
  });

  test('treats the overtime flag as a boolean, not as 0/1 vs true/false', () => {
    assert.strictEqual(
      needsGoalscorerFetch({ ...played, isOvertime: true }, { ...storedSame, is_overtime: 1 }, 3),
      false,
      'the DB stores 1 and the scraper may hand back true — that is not a change'
    );
  });

  test('--refresh-goalscorers overrides the skip', () => {
    assert.strictEqual(needsGoalscorerFetch(played, storedSame, 3, true), true);
  });

  test('but refresh still does not invent work for an unplayed game', () => {
    const unplayed = { swehockeyGameId: 8003, homeScore: null, awayScore: null, isOvertime: 0 };
    assert.strictEqual(needsGoalscorerFetch(unplayed, null, 0, true), false);
  });
});

describe('forum scrape cursor', () => {
  const statePath = join(tmpdir(), `lhftips-scrape-state-${process.pid}.json`);
  const url = 'https://www.luleahockeyforum.com/t2964-tipstavling-lulea-hockeys-grundserie-2026-2027';

  test('keys the cursor per thread, so a new season does not inherit a stale one', () => {
    assert.strictEqual(extractThreadId(url), '2964');
    assert.strictEqual(extractThreadId('https://example.com/t3111-next-season'), '3111');
    assert.strictEqual(extractThreadId('https://example.com/no-thread'), null);
  });

  test('the cursor only ever moves forward', () => {
    if (existsSync(statePath)) rmSync(statePath);
    saveScrapeState(url, { lastPostId: 500, lastPage: 10 }, statePath);
    saveScrapeState(url, { lastPostId: 300, lastPage: 6 }, statePath);
    const state = loadScrapeState(url, statePath);
    assert.strictEqual(state.lastPostId, 500, 'a lower id must not regress the cursor');
    saveScrapeState(url, { lastPostId: 900, lastPage: 18 }, statePath);
    assert.strictEqual(loadScrapeState(url, statePath).lastPostId, 900);
    rmSync(statePath);
  });

  test('a different thread gets its own cursor', () => {
    if (existsSync(statePath)) rmSync(statePath);
    const other = 'https://www.luleahockeyforum.com/t3100-tipstavling-2027-2028';
    saveScrapeState(url, { lastPostId: 500, lastPage: 10 }, statePath);
    assert.strictEqual(loadScrapeState(other, statePath), null);
    saveScrapeState(other, { lastPostId: 7, lastPage: 1 }, statePath);
    assert.strictEqual(loadScrapeState(url, statePath).lastPostId, 500);
    assert.strictEqual(loadScrapeState(other, statePath).lastPostId, 7);
    rmSync(statePath);
  });
});

describe('rewinding the cursor', () => {
  const statePath = join(tmpdir(), `lhftips-rewind-${process.pid}.json`);
  const url = 'https://www.luleahockeyforum.com/t2964-tipstavling-lulea-hockeys-grundserie-2026-2027';

  test('setScrapeState moves the cursor BACKWARDS, unlike saveScrapeState', () => {
    if (existsSync(statePath)) rmSync(statePath);
    saveScrapeState(url, { lastPostId: 5000, lastPage: 20 }, statePath);

    saveScrapeState(url, { lastPostId: 4710, lastPage: 8 }, statePath);
    assert.strictEqual(loadScrapeState(url, statePath).lastPostId, 5000, 'the safe one never regresses');

    setScrapeState(url, { lastPostId: 4710, lastPage: 8 }, statePath);
    const state = loadScrapeState(url, statePath);
    assert.strictEqual(state.lastPostId, 4710, 'the deliberate one does');
    assert.strictEqual(state.lastPage, 8);
    rmSync(statePath);
  });

  test('defaults to page 1, since a post id says nothing about its page', () => {
    if (existsSync(statePath)) rmSync(statePath);
    setScrapeState(url, { lastPostId: 4710 }, statePath);
    assert.strictEqual(loadScrapeState(url, statePath).lastPage, 1);
    rmSync(statePath);
  });

  test('clamps nonsense rather than storing it', () => {
    if (existsSync(statePath)) rmSync(statePath);
    setScrapeState(url, { lastPostId: -5, lastPage: 0 }, statePath);
    const state = loadScrapeState(url, statePath);
    assert.strictEqual(state.lastPostId, 0);
    assert.strictEqual(state.lastPage, 1);
    rmSync(statePath);
  });

  test('clearScrapeState forgets one thread and reports whether it had to', () => {
    if (existsSync(statePath)) rmSync(statePath);
    setScrapeState(url, { lastPostId: 4710, lastPage: 8 }, statePath);
    assert.strictEqual(clearScrapeState(url, statePath), true);
    assert.strictEqual(loadScrapeState(url, statePath), null);
    assert.strictEqual(clearScrapeState(url, statePath), false);
    rmSync(statePath);
  });

  test('clearing one thread leaves another thread alone', () => {
    if (existsSync(statePath)) rmSync(statePath);
    const other = 'https://www.luleahockeyforum.com/t3100-tipstavling-2027-2028';
    setScrapeState(url, { lastPostId: 4710, lastPage: 8 }, statePath);
    setScrapeState(other, { lastPostId: 12, lastPage: 1 }, statePath);
    clearScrapeState(url, statePath);
    assert.strictEqual(loadScrapeState(other, statePath).lastPostId, 12);
    rmSync(statePath);
  });
});

describe('re-reading must replace rows, not duplicate them', () => {
  const header = 'username,timestamp,date,home_team,away_team,home_score,away_score,scorer,raw_text';
  const lines = [
    header,
    'PM,2026-10-01T18:00:00,2026-10-01,Luleå HF,HV71,3,2,Brännström,raw',
    'Urken,2026-10-04T18:00:00,2026-10-04,Rögle BK,Luleå HF,1,2,Nässén,raw',
    '#Bamsefar @2026-10-05T18:00:00: hejsan allihopa',
    '#[fixed]Hedanders @2026-10-06T18:00:00: luleå timrå 2-1 omark',
    'Hedanders,2026-10-06T18:00:00,2026-10-06,Luleå HF,Timrå IK,2,1,Omark,fixed',
  ];

  test('identifies the post a data row came from', () => {
    assert.strictEqual(postKeyOfLine(lines[1]), postKey('PM', '2026-10-01T18:00:00'));
  });

  test('identifies the post a pending review line came from', () => {
    assert.strictEqual(postKeyOfLine(lines[3]), postKey('Bamsefar', '2026-10-05T18:00:00'));
  });

  test('identifies the post a #[fixed] line came from', () => {
    assert.strictEqual(postKeyOfLine(lines[4]), postKey('Hedanders', '2026-10-06T18:00:00'));
  });

  test('ignores the header', () => {
    assert.strictEqual(postKeyOfLine(header), null);
  });

  test('removes every line for a re-read post, data and comment alike', () => {
    const { lines: kept, removed } = removeRowsForPosts(lines, [
      postKey('Hedanders', '2026-10-06T18:00:00'),
    ]);
    assert.strictEqual(removed, 2, 'both the #[fixed] marker and its row');
    assert.ok(!kept.some(l => l.includes('Hedanders')));
    assert.strictEqual(kept.length, lines.length - 2);
  });

  test('leaves posts that were not re-read completely alone', () => {
    const { lines: kept, removed } = removeRowsForPosts(lines, [
      postKey('Bamsefar', '2026-10-05T18:00:00'),
    ]);
    assert.strictEqual(removed, 1);
    assert.ok(kept.includes(header));
    assert.ok(kept.some(l => l.startsWith('PM,')));
    assert.ok(kept.some(l => l.startsWith('Urken,')));
  });

  test('removes nothing when no post matches', () => {
    const { removed } = removeRowsForPosts(lines, [postKey('Nobody', '2026-01-01T00:00:00')]);
    assert.strictEqual(removed, 0);
  });

  test('post keys ignore case and stray whitespace', () => {
    assert.strictEqual(postKey('PM', '2026-10-01T18:00:00'), postKey('  pm ', '2026-10-01T18:00:00'));
  });
});
