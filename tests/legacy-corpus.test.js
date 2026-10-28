import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractGuessesFromPost } from '../src/parsers/guess-parser.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'legacy');

/**
 * Real posts the 2018-2024 toolset (D:\proj\lhftips) could not parse, kept as
 * "=== <postid>,<user> <<< Not a Guess. >>>:<text>" lines. See the README in
 * tests/fixtures/legacy for the format.
 */
function unparsedPosts(file) {
  return readFileSync(join(FIXTURES, file), 'utf-8')
    .split(/\r?\n/)
    .filter(line => line.includes('Not a Guess'))
    .map(line => ({
      user: (line.match(/=== -?\d+,([^ ]+)/) || [, '?'])[1],
      text: line.split('>>>:').slice(1).join('>>>:')
    }))
    .filter(p => p.text.length > 0);
}

// A guess needs a date to exist at all; posts without one (round-standings
// posts, chatter) are correctly not guesses and are not interesting here.
const HAS_DATE = /\d{4}-+\d{1,2}-+\d{1,2}/;

describe('legacy corpus fixtures', () => {
  test('both threads load and contain unparsed posts', () => {
    assert.ok(unparsedPosts('thread-2023-24.txt').length > 50);
    assert.ok(unparsedPosts('thread-2021-22.txt').length > 10);
  });

  test('most unparsed posts carry no date, i.e. are genuinely not guesses', () => {
    const posts = unparsedPosts('thread-2023-24.txt');
    const dateless = posts.filter(p => !HAS_DATE.test(p.text));
    // Round-standings posts dominate; if this ratio moves, the fixture changed.
    assert.ok(dateless.length / posts.length > 0.7);
  });
});

describe('guess formats the legacy corpus exercises', () => {
  // These are the shapes the old parser choked on that v2 handles today.
  const handled = [
    ['plain guess on its own line', '2023-09-16, Luleå - Timrå, 4-3, Andreasson', '2023-09-16'],
    ['colon between teams and score', '2023-09-21, Luleå - Örebro: 3 - 4, Kempe', '2023-09-21'],
    ['commentary on a preceding line', 'Fasen.. sen trådöppning!\n2023-09-16, Luleå - Timrå, 4-3, Andreasson', '2023-09-16']
  ];

  for (const [label, text, expectedDate] of handled) {
    test(label, () => {
      const [guess] = extractGuessesFromPost(text, 2023);
      assert.ok(guess, `expected a guess from: ${text}`);
      assert.strictEqual(guess.date, expectedDate);
    });
  }
});

describe('known gap: commentary glued to the guess with no line break', () => {
  // The scraper flattens a post's <br> tags away, so a tip written under a line
  // of commentary arrives as one unbroken string. The parser is line-oriented
  // and sees no guess at all. 15 of the 16 date-bearing posts in the corpus
  // fail this way, and the same shape appears in live scrapes.
  const glued = [
    ['Urken 341519', 'Rönk är Rönk!2023-09-16, Luleå - Timrå, 4-3, Andreasson', '2023-09-16'],
    ['LulefanGBG 342006', 'Tippade förlust sist: 2023-09-21, Luleå - Örebro: 3 - 4, Kempe', '2023-09-21'],
    ['Hedanders 342531', 'Efter fyra spelade matcher.2023-09-28, Luleå - HV71, 4-1, Shinmimin', '2023-09-28']
  ];

  for (const [label, text, expectedDate] of glued) {
    test(label, { skip: 'parser is line-oriented; see README in tests/fixtures/legacy' }, () => {
      const [guess] = extractGuessesFromPost(text, 2023);
      assert.ok(guess, `expected a guess from: ${text}`);
      assert.strictEqual(guess.date, expectedDate);
    });
  }

  test('splitting on the date recovers them, which is why the gap is fixable', () => {
    let recovered = 0;
    for (const p of unparsedPosts('thread-2023-24.txt')) {
      if (!HAS_DATE.test(p.text)) continue;
      const split = p.text.replace(/(\d{4}-+\d{1,2}-+\d{1,2})/g, '\n$1');
      if (extractGuessesFromPost(split, 2023).length) recovered++;
    }
    assert.ok(recovered >= 13, `only ${recovered} recovered`);
  });
});
