import { test, describe } from 'node:test';
import assert from 'node:assert';
import { isLaterPost } from '../src/db/queries.js';

/**
 * Which of a user's posts counts as their guess.
 *
 * The forum hands out post ids in order and never reformats them, so they
 * decide whenever both sides have one. Timestamps only come into it for rows
 * imported from a CSV written before the id column existed.
 */
describe('isLaterPost', () => {
  const stored = (post_id, post_timestamp) => ({ post_id, post_timestamp });

  test('a higher post id is the later post', () => {
    assert.strictEqual(isLaterPost(413325, '2026-09-24T19:02:00', stored(413300, '2026-09-23T16:20:00')), true);
  });

  test('a lower post id is not, whatever the timestamps say', () => {
    // The old 12-hour bug produced exactly this: a repost that read as 07:02
    // against an earlier post that read as 08:30.
    assert.strictEqual(isLaterPost(413300, '2026-09-24T07:02:00', stored(413290, '2026-09-24T08:30:00')), true);
    assert.strictEqual(isLaterPost(413290, '2026-09-24T08:30:00', stored(413300, '2026-09-24T07:02:00')), false);
  });

  test('two posts in the same minute are still ordered', () => {
    // The board publishes minutes, so the timestamps are equal and ">" is
    // false — a correction posted seconds later used to be dropped.
    assert.strictEqual(isLaterPost(413301, '2026-09-24T18:44:00', stored(413300, '2026-09-24T18:44:00')), true);
  });

  test('the same post is not later than itself', () => {
    assert.strictEqual(isLaterPost(413300, '2026-09-23T16:20:00', stored(413300, '2026-09-23T16:20:00')), false);
  });

  test('falls back to timestamps when the stored row predates post ids', () => {
    assert.strictEqual(isLaterPost(413325, '2026-09-24T19:02:00', stored(null, '2026-09-23T16:20:00')), true);
    assert.strictEqual(isLaterPost(413325, '2026-09-22T10:00:00', stored(null, '2026-09-23T16:20:00')), false);
  });

  test('falls back to timestamps when the incoming row has no id', () => {
    assert.strictEqual(isLaterPost(null, '2026-09-24T19:02:00', stored(413300, '2026-09-23T16:20:00')), true);
  });

  test('an unreadable timestamp loses, which is why the id is preferred', () => {
    // Documents the fallback's weakness rather than endorsing it: a blank
    // timestamp never wins, so without an id a repost can be silently ignored.
    assert.strictEqual(isLaterPost(null, '', stored(null, '2026-09-23T16:20:00')), false);
  });
});

/**
 * Re-importing a post. A hand-corrected row keeps the id of the post it fixes,
 * so the same id arriving with different content must replace the stored guess
 * — the import used to drop it because the id was not strictly greater.
 */
describe('upsertGuess', async () => {
  const { mkdtempSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { initDatabase, prepare, closeDatabase } = await import('../src/db/database.js');
  const { upsertGuess } = await import('../src/db/queries.js');

  await initDatabase(join(mkdtempSync(join(tmpdir(), 'lhftips-')), 'test.db'));
  prepare("INSERT INTO users (id, forum_username) VALUES (1, 'u')").run();
  prepare("INSERT INTO matches (id, match_date, home_team, away_team) VALUES (1, '2026-10-03', 'Luleå HF', 'HV71')").run();
  const stored = () => prepare('SELECT * FROM guesses WHERE user_id = 1 AND match_id = 1').get();

  test('a corrected version of the same post replaces the stored guess', async () => {
    await upsertGuess(1, 1, '2026-10-02T16:53:00', 'Luleå - HV71 2-4 Kopanen', 2, 4, 'Kopanen', true, 414196);
    const r = await upsertGuess(1, 1, '2026-10-02T16:53:00', 'Luleå - HV71 2-4 Koppanen', 2, 4, 'Koppanen', true, 414196);
    assert.strictEqual(r.changes, 1);
    assert.strictEqual(stored().predicted_scorer, 'Koppanen');
  });

  test('re-reading the same post unchanged is not counted as an import', async () => {
    const r = await upsertGuess(1, 1, '2026-10-02T16:53:00', 'Luleå - HV71 2-4 Koppanen', 2, 4, 'Koppanen', true, 414196);
    assert.strictEqual(r.changes, 0);
  });

  test('an earlier post never replaces a later one', async () => {
    await upsertGuess(1, 1, '2026-10-03T13:32:00', 'Luleå - HV71 1-4 Levtchi', 1, 4, 'Levtchi', true, 414214);
    await upsertGuess(1, 1, '2026-10-02T16:53:00', 'Luleå - HV71 3-3 X', 3, 3, 'X', true, 414196);
    assert.strictEqual(stored().post_id, 414214);
    assert.strictEqual(stored().predicted_scorer, 'Levtchi');
    closeDatabase();
  });
});
