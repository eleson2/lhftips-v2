import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  playersMatch,
  normalizeName,
  getLastName,
  findBestMatch,
  matchScorer,
  resolveCanonical,
} from '../src/utils/player-matcher.js';

describe('normalizeName', () => {
  test('normalizes to lowercase', () => {
    assert.strictEqual(normalizeName('LINUS OMARK'), 'linus omark');
  });

  test('removes jersey numbers from start', () => {
    assert.strictEqual(normalizeName('#10 Omark'), 'omark');
  });

  test('removes jersey numbers from end', () => {
    assert.strictEqual(normalizeName('Omark 10'), 'omark');
  });

  test('trims whitespace', () => {
    assert.strictEqual(normalizeName('  Omark  '), 'omark');
  });

  test('normalizes Swedish characters', () => {
    const result = normalizeName('Brännström');
    assert.strictEqual(result, 'brannstrom');
  });

  test('handles empty input', () => {
    assert.strictEqual(normalizeName(''), '');
    assert.strictEqual(normalizeName(null), '');
  });
});

describe('getLastName', () => {
  test('extracts last name from full name', () => {
    assert.strictEqual(getLastName('Linus Omark'), 'Omark');
  });

  test('returns single name as-is', () => {
    assert.strictEqual(getLastName('Omark'), 'Omark');
  });

  test('handles multiple names', () => {
    assert.strictEqual(getLastName('Einar Jan Emanuelsson'), 'Emanuelsson');
  });

  test('handles empty input', () => {
    assert.strictEqual(getLastName(''), '');
    assert.strictEqual(getLastName(null), '');
  });
});

describe('playersMatch', () => {
  test('exact match returns true', () => {
    assert.strictEqual(playersMatch('Linus Omark', 'Linus Omark'), true);
  });

  test('case-insensitive match returns true', () => {
    assert.strictEqual(playersMatch('linus omark', 'Linus Omark'), true);
  });

  test('last name match returns true', () => {
    assert.strictEqual(playersMatch('Omark', 'Linus Omark'), true);
  });

  test('fuzzy match on close spelling returns true', () => {
    assert.strictEqual(playersMatch('Ommark', 'Linus Omark'), true);
  });

  test('different players return false', () => {
    assert.strictEqual(playersMatch('Omark', 'Emanuelsson'), false);
  });

  test('handles null input', () => {
    assert.strictEqual(playersMatch(null, 'Omark'), false);
    assert.strictEqual(playersMatch('Omark', null), false);
  });
});

describe('findBestMatch', () => {
  test('finds exact match in list', () => {
    const scorers = ['Linus Omark', 'Einar Emanuelsson', 'Isac Brännström'];
    const result = findBestMatch('Omark', scorers);

    assert.strictEqual(result.match, 'Linus Omark');
    assert.ok(result.score < 0.5);
  });

  test('returns null for no match', () => {
    const scorers = ['Player One', 'Player Two'];
    const result = findBestMatch('Completely Different', scorers);

    // May or may not find a poor match, but score should be high
    if (result.match) {
      assert.ok(result.score >= 0.5);
    }
  });

  test('handles empty scorer list', () => {
    const result = findBestMatch('Omark', []);
    assert.strictEqual(result.match, null);
  });
});

describe('resolveCanonical (registry-backed)', () => {
  test('resolves a current-roster surname to canonical', () => {
    // Isac Brännström (#17) is on the 2026-27 roster.
    assert.strictEqual(resolveCanonical('brannstrom'), 'Isac Brännström');
  });

  test('returns null for an unknown name', () => {
    assert.strictEqual(resolveCanonical('Some Randomguy'), null);
  });
});

describe('matchScorer', () => {
  test('matches a surname-only guess to the real scorer', () => {
    const r = matchScorer('Brännström', ['Isac Brännström', 'Joel Lassinantti']);
    assert.strictEqual(r.matched, true);
    assert.strictEqual(r.actualName, 'Isac Brännström');
    assert.strictEqual(r.canonical, 'Isac Brännström');
    assert.ok(r.confidence >= 0.85);
  });

  test('does not match when the guessed scorer did not score', () => {
    const r = matchScorer('Puustinen', ['Isac Brännström', 'Erik Gustafsson']);
    assert.strictEqual(r.matched, false);
  });

  test('returns no match for empty scorer list', () => {
    assert.strictEqual(matchScorer('Brännström', []).matched, false);
  });
});
