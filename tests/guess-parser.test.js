import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseGuess, parseDate, parseScore, parseTeams, extractGuessesFromPost } from '../src/parsers/guess-parser.js';

describe('parseDate', () => {
  test('parses YYYY-MM-DD format', () => {
    assert.strictEqual(parseDate('2023-09-14'), '2023-09-14');
  });

  test('parses DD/MM/YYYY format', () => {
    assert.strictEqual(parseDate('14/09/2023'), '2023-09-14');
  });

  test('parses DD/MM format with default year', () => {
    assert.strictEqual(parseDate('14/09', 2023), '2023-09-14');
  });

  test('parses DD-MM format', () => {
    assert.strictEqual(parseDate('14-09', 2023), '2023-09-14');
  });

  test('parses DD.MM format', () => {
    assert.strictEqual(parseDate('14.09', 2023), '2023-09-14');
  });

  test('returns null for invalid date', () => {
    assert.strictEqual(parseDate('invalid'), null);
  });
});

describe('parseScore', () => {
  test('parses X-Y format', () => {
    const result = parseScore('1-3');
    assert.deepStrictEqual(result, { home: 1, away: 3 });
  });

  test('parses X - Y format with spaces', () => {
    const result = parseScore('1 - 3');
    assert.deepStrictEqual(result, { home: 1, away: 3 });
  });

  test('parses X:Y format', () => {
    const result = parseScore('2:4');
    assert.deepStrictEqual(result, { home: 2, away: 4 });
  });

  test('returns null for invalid score', () => {
    assert.strictEqual(parseScore('invalid'), null);
  });
});

describe('parseTeams', () => {
  test('parses standard team format', () => {
    const result = parseTeams('Oskarshamn - Luleå');
    assert.ok(result);
    assert.strictEqual(result.home, 'IK Oskarshamn');
    assert.strictEqual(result.away, 'Luleå HF');
  });

  test('handles team abbreviations', () => {
    const result = parseTeams('LHF - SAIK');
    assert.ok(result);
    assert.strictEqual(result.home, 'Luleå HF');
    assert.strictEqual(result.away, 'Skellefteå AIK');
  });

  test('returns null for invalid teams', () => {
    assert.strictEqual(parseTeams(''), null);
  });
});

describe('parseGuess', () => {
  test('parses standard guess format', () => {
    const result = parseGuess('2023-09-14, Oskarshamn - Luleå, 1-3, Linus Omark', 2023);

    assert.ok(result);
    assert.strictEqual(result.date, '2023-09-14');
    assert.strictEqual(result.homeTeam, 'IK Oskarshamn');
    assert.strictEqual(result.awayTeam, 'Luleå HF');
    assert.strictEqual(result.homeScore, 1);
    assert.strictEqual(result.awayScore, 3);
    assert.strictEqual(result.scorer, 'Linus Omark');
    assert.strictEqual(result.luleaIsHome, false);
  });

  test('parses guess without scorer', () => {
    const result = parseGuess('2023-09-14, Luleå - Skellefteå, 3-1', 2023);

    assert.ok(result);
    assert.strictEqual(result.date, '2023-09-14');
    assert.strictEqual(result.homeScore, 3);
    assert.strictEqual(result.awayScore, 1);
    assert.strictEqual(result.scorer, null);
    assert.strictEqual(result.luleaIsHome, true);
  });

  test('handles semicolon separator', () => {
    const result = parseGuess('2023-09-14; Luleå - Frölunda; 2-1; Omark', 2023);

    assert.ok(result);
    assert.strictEqual(result.homeScore, 2);
    assert.strictEqual(result.awayScore, 1);
  });

  test('returns null for non-Luleå match', () => {
    const result = parseGuess('2023-09-14, Frölunda - Skellefteå, 2-1', 2023);
    assert.strictEqual(result, null);
  });

  test('returns null for invalid format', () => {
    const result = parseGuess('just some random text', 2023);
    assert.strictEqual(result, null);
  });

  test('captures scorer glued to score with no separating comma', () => {
    const result = parseGuess('2023-09-14, Oskarshamn - Luleå, 2-5 Shinnimin', 2023);
    assert.ok(result);
    assert.strictEqual(result.homeScore, 2);
    assert.strictEqual(result.awayScore, 5);
    assert.strictEqual(result.scorer, 'Shinnimin');
  });

  test('keeps full trailing text as scorer when glued to score', () => {
    const result = parseGuess('2023-09-14, Oskarshamn - Luleå, 2-5 Linus Omark tack för idag', 2023);
    assert.ok(result);
    assert.strictEqual(result.scorer, 'Linus Omark tack för idag');
  });

  test('handles colon used instead of comma before the score', () => {
    const result = parseGuess('2023-09-16, Luleå - Timrå: 3 - 4, Hanzl', 2023);
    assert.ok(result);
    assert.strictEqual(result.homeTeam, 'Luleå HF');
    assert.strictEqual(result.homeScore, 3);
    assert.strictEqual(result.awayScore, 4);
    assert.strictEqual(result.scorer, 'Hanzl');
  });

  test('handles colon before score with no space between score and comma', () => {
    const result = parseGuess('2023-09-30, Luleå - Linköping: 5-1, Einar', 2023);
    assert.ok(result);
    assert.strictEqual(result.homeScore, 5);
    assert.strictEqual(result.awayScore, 1);
    assert.strictEqual(result.scorer, 'Einar');
  });

  test('handles no punctuation at all between team and score', () => {
    const result = parseGuess('2023-10-28, Modo - Luleå 2-5, Shinnimin', 2023);
    assert.ok(result);
    assert.strictEqual(result.homeTeam, 'MoDo Hockey');
    assert.strictEqual(result.homeScore, 2);
    assert.strictEqual(result.awayScore, 5);
    assert.strictEqual(result.scorer, 'Shinnimin');
  });

  test('handles no punctuation before score with double space', () => {
    const result = parseGuess('2023-01-31, Malmö - Luleå  2-4, Shinnimin', 2023);
    assert.ok(result);
    assert.strictEqual(result.homeScore, 2);
    assert.strictEqual(result.awayScore, 4);
  });

  test('handles no comma at all (teams, score, and scorer all space-separated)', () => {
    const result = parseGuess('2023-02-14, Timrå - Luleå 1-3 Shinnimin', 2023);
    assert.ok(result);
    assert.strictEqual(result.homeTeam, 'Timrå IK');
    assert.strictEqual(result.homeScore, 1);
    assert.strictEqual(result.awayScore, 3);
    assert.strictEqual(result.scorer, 'Shinnimin');
  });
});

describe('extractGuessesFromPost', () => {
  test('extracts multiple guesses from post', () => {
    const postText = `
      Here are my guesses:
      2023-09-14, Oskarshamn - Luleå, 1-3, Omark
      2023-09-16, Luleå - Skellefteå, 3-2, Emanuelsson
    `;

    const guesses = extractGuessesFromPost(postText, 2023);
    assert.strictEqual(guesses.length, 2);
    assert.strictEqual(guesses[0].date, '2023-09-14');
    assert.strictEqual(guesses[1].date, '2023-09-16');
  });

  test('ignores non-guess lines', () => {
    const postText = `
      Hello everyone!
      2023-09-14, Luleå - Frölunda, 4-2, Omark
      Good luck!
    `;

    const guesses = extractGuessesFromPost(postText, 2023);
    assert.strictEqual(guesses.length, 1);
  });

  test('returns empty array for post without guesses', () => {
    const postText = 'This is just a regular post without any guesses.';
    const guesses = extractGuessesFromPost(postText, 2023);
    assert.strictEqual(guesses.length, 0);
  });
});
