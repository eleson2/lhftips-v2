import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as cheerio from 'cheerio';
import { getOffsetFromUrl, buildUrlWithOffset, parsePaginationInfo } from '../src/scrapers/forum-scraper.js';

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
