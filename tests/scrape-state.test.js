import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, rmSync } from 'fs';
import { extractThreadId, loadScrapeState, saveScrapeState } from '../src/utils/scrape-state.js';

const TEST_STATE_PATH = 'tests/tmp-scrape-state.json';

beforeEach(() => {
  if (existsSync(TEST_STATE_PATH)) rmSync(TEST_STATE_PATH);
});

afterEach(() => {
  if (existsSync(TEST_STATE_PATH)) rmSync(TEST_STATE_PATH);
});

describe('extractThreadId', () => {
  test('extracts the numeric thread id from a thread URL', () => {
    assert.strictEqual(
      extractThreadId('https://www.luleahockeyforum.com/t2964-tipstavling-2026-2027'),
      '2964'
    );
  });

  test('extracts the thread id even with a page offset in the URL', () => {
    assert.strictEqual(
      extractThreadId('https://www.luleahockeyforum.com/t2343p550-tipstavling-2022-2023'),
      '2343'
    );
  });

  test('returns null for a non-matching URL', () => {
    assert.strictEqual(extractThreadId('https://example.com/no-thread-id'), null);
    assert.strictEqual(extractThreadId(null), null);
  });
});

describe('loadScrapeState / saveScrapeState', () => {
  const forumUrl = 'https://www.luleahockeyforum.com/t2964-tipstavling-2026-2027';

  test('returns null when no state has been saved for the thread', () => {
    assert.strictEqual(loadScrapeState(forumUrl, TEST_STATE_PATH), null);
  });

  test('round-trips a saved cursor', () => {
    saveScrapeState(forumUrl, { lastPostId: 411875, lastPage: 12 }, TEST_STATE_PATH);
    const state = loadScrapeState(forumUrl, TEST_STATE_PATH);
    assert.ok(state);
    assert.strictEqual(state.lastPostId, 411875);
    assert.strictEqual(state.lastPage, 12);
    assert.strictEqual(state.forumUrl, forumUrl);
  });

  test('never regresses lastPostId on a later save with a smaller value', () => {
    saveScrapeState(forumUrl, { lastPostId: 500, lastPage: 5 }, TEST_STATE_PATH);
    saveScrapeState(forumUrl, { lastPostId: 100, lastPage: 6 }, TEST_STATE_PATH);
    const state = loadScrapeState(forumUrl, TEST_STATE_PATH);
    assert.strictEqual(state.lastPostId, 500);
    assert.strictEqual(state.lastPage, 6);
  });

  test('keeps separate cursors for different threads (different seasons)', () => {
    const threadA = 'https://www.luleahockeyforum.com/t2343-tipstavling-2022-2023';
    const threadB = 'https://www.luleahockeyforum.com/t2964-tipstavling-2026-2027';
    saveScrapeState(threadA, { lastPostId: 300000, lastPage: 20 }, TEST_STATE_PATH);
    saveScrapeState(threadB, { lastPostId: 400000, lastPage: 3 }, TEST_STATE_PATH);

    assert.strictEqual(loadScrapeState(threadA, TEST_STATE_PATH).lastPostId, 300000);
    assert.strictEqual(loadScrapeState(threadB, TEST_STATE_PATH).lastPostId, 400000);
  });
});
