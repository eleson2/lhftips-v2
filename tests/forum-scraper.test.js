import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as cheerio from 'cheerio';
import { getOffsetFromUrl, buildUrlWithOffset, parsePaginationInfo, parseAuthorTimestamp } from '../src/scrapers/forum-scraper.js';

describe('parsePaginationInfo', () => {
  test('parses "Sida X av Y" (Swedish) from a real pagination block', () => {
    // Reproduces the actual markup shape seen on luleahockeyforum.com
    const $ = cheerio.load(`
      <div class="pagination">
        <span>Sida 1 av 16</span>
        <a href="/t2343p50-thread">2</a>
        <a href="/t2343p750-thread">16</a>
      </div>
    `);
    assert.deepStrictEqual(parsePaginationInfo($), { current: 1, total: 16 });
  });

  test('parses the last page ("Sida 16 av 16", no further links)', () => {
    const $ = cheerio.load(`<div class="pagination">Sida 16 av 16</div>`);
    assert.deepStrictEqual(parsePaginationInfo($), { current: 16, total: 16 });
  });

  test('parses a single-page thread ("Sida 1 av 1")', () => {
    const $ = cheerio.load(`<div class="pagination">Sida 1 av 1</div>`);
    assert.deepStrictEqual(parsePaginationInfo($), { current: 1, total: 1 });
  });

  test('parses the English "Page X of Y" variant', () => {
    const $ = cheerio.load(`<div class="pagination">Page 3 of 9</div>`);
    assert.deepStrictEqual(parsePaginationInfo($), { current: 3, total: 9 });
  });

  test('returns null when no pagination block is present', () => {
    const $ = cheerio.load('<div class="content">just a post, no pager</div>');
    assert.strictEqual(parsePaginationInfo($), null);
  });

  test('returns null when the pagination block does not match the expected pattern', () => {
    const $ = cheerio.load('<div class="pagination">Some unrelated pager text</div>');
    assert.strictEqual(parsePaginationInfo($), null);
  });
});

describe('getOffsetFromUrl / buildUrlWithOffset (pagination URL math)', () => {
  test('offset 0 for a bare thread URL', () => {
    assert.strictEqual(getOffsetFromUrl('https://forum.example.com/t2343-thread'), 0);
  });

  test('extracts the offset from a paged URL', () => {
    assert.strictEqual(getOffsetFromUrl('https://forum.example.com/t2343p750-thread'), 750);
  });

  test('building offset 0 returns the base URL unchanged', () => {
    assert.strictEqual(
      buildUrlWithOffset('https://forum.example.com/t2343-thread', 0),
      'https://forum.example.com/t2343-thread'
    );
  });

  test('round-trips offset math across consecutive pages (50/page)', () => {
    let url = 'https://forum.example.com/t2343-thread';
    for (let page = 2; page <= 16; page++) {
      url = buildUrlWithOffset(url, (page - 1) * 50);
      assert.strictEqual(getOffsetFromUrl(url), (page - 1) * 50);
    }
  });
});

describe('parseAuthorTimestamp', () => {
  // Reference "now" for the relative forms: Sat 19 Sep 2026, local time.
  const now = new Date(2026, 8, 19, 20, 0);

  test('parses the comma separator ("tor 14 sep 2023, 16:34")', () => {
    assert.strictEqual(parseAuthorTimestamp('av Ronken tor 14 sep 2023, 16:34', now), '2023-09-14T16:34:00');
  });

  test('parses the dash separator the forum renders today ("6 jul 2026 - 21:51")', () => {
    assert.strictEqual(parseAuthorTimestamp('av Puckad man 6 jul 2026 - 21:51', now), '2026-07-06T21:51:00');
  });

  test('resolves "Igar pa HH:MM" against the previous day', () => {
    assert.strictEqual(parseAuthorTimestamp('av icemask Igår på 11:03', now), '2026-09-18T11:03:00');
  });

  test('resolves "Idag pa HH:MM" against today', () => {
    assert.strictEqual(parseAuthorTimestamp('av Puckad Idag på 18:18', now), '2026-09-19T18:18:00');
  });

  test('pads a single-digit hour so the result stays ISO-shaped', () => {
    assert.strictEqual(parseAuthorTimestamp('av X Idag kl. 9:05', now), '2026-09-19T09:05:00');
  });

  test('crosses a month boundary when yesterday was last month', () => {
    const firstOfMonth = new Date(2026, 9, 1, 12, 0);
    assert.strictEqual(parseAuthorTimestamp('av Y Igår på 23:10', firstOfMonth), '2026-09-30T23:10:00');
  });

  test('returns null for a dateless author line (sponsored content, empty)', () => {
    assert.strictEqual(parseAuthorTimestamp('av Sponsored content', now), null);
    assert.strictEqual(parseAuthorTimestamp('', now), null);
  });

  // The same thread, fetched with the scraper's own Accept-Language header,
  // comes back month-first on a 12-hour clock. Every line below is verbatim
  // from the 2026-27 thread, where the old day-first-only pattern read them
  // as null and lost the timestamp of every post older than yesterday.
  test('parses the month-first 12-hour form ("tis sep 22, 2026 9:16 pm")', () => {
    assert.strictEqual(parseAuthorTimestamp('av Sigge75 tis sep 22, 2026 9:16 pm', now), '2026-09-22T21:16:00');
  });

  test('parses month-first with a two-digit day ("man jul 06, 2026 9:51 pm")', () => {
    assert.strictEqual(parseAuthorTimestamp('av Puckad mån jul 06, 2026 9:51 pm', now), '2026-07-06T21:51:00');
  });

  test('does not mistake the weekday for the month', () => {
    // "tor" leads the line; only "sep" is a month, and the day belongs to it.
    assert.strictEqual(parseAuthorTimestamp('av Bamsefar tor sep 17, 2026 4:32 pm', now), '2026-09-17T16:32:00');
  });

  test('keeps the pm on a relative time ("Igar pa 4:20 pm" is 16:20, not 04:20)', () => {
    assert.strictEqual(parseAuthorTimestamp('av Hjalmar_Vuopio Igår på 4:20 pm', now), '2026-09-18T16:20:00');
  });

  test('leaves am times alone and keeps 12 am / 12 pm straight', () => {
    assert.strictEqual(parseAuthorTimestamp('av Metheuz Idag på 8:30 am', now), '2026-09-19T08:30:00');
    assert.strictEqual(parseAuthorTimestamp('av Redbear Idag på 12:43 pm', now), '2026-09-19T12:43:00');
    assert.strictEqual(parseAuthorTimestamp('av X Idag på 12:05 am', now), '2026-09-19T00:05:00');
  });

  test('still reads a 24-hour time that carries no am/pm', () => {
    assert.strictEqual(parseAuthorTimestamp('av storeken tis sep 22, 2026 23:15', now), '2026-09-22T23:15:00');
  });

  // Third shape seen from the same thread on the same day as the two above.
  test('parses the ISO form ("av Bamsefar 2026-09-17, 16:32")', () => {
    assert.strictEqual(parseAuthorTimestamp('av Bamsefar 2026-09-17, 16:32', now), '2026-09-17T16:32:00');
    assert.strictEqual(parseAuthorTimestamp('av Puckad 2026-07-06, 21:51', now), '2026-07-06T21:51:00');
  });

  test('parses an ISO date on a 12-hour clock', () => {
    assert.strictEqual(parseAuthorTimestamp('av X 2026-09-17 4:32 pm', now), '2026-09-17T16:32:00');
  });
});
