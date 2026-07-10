import { test, describe } from 'node:test';
import assert from 'node:assert';
import { diagnoseGuess } from '../src/parsers/guess-diagnose.js';

describe('diagnoseGuess', () => {
  test('recognizes text that parses with the current parser', () => {
    const d = diagnoseGuess('2023-09-14, Oskarshamn - Luleå, 2-5 Shinnimin', 2023);
    assert.strictEqual(d.complete, true);
    assert.strictEqual(d.suggestion, '2023-09-14, IK Oskarshamn - Luleå HF, 2-5, Shinnimin');
  });

  test('reconstructs multiple guesses from one post', () => {
    const d = diagnoseGuess(
      '2023-09-28, Luleå - HV71, 5-2, Omark\n2023-09-30, Luleå - Linköping, 5-2, Shinnimin', 2023
    );
    assert.strictEqual(d.complete, true);
    assert.strictEqual(d.suggestion.split('\n').length, 2);
  });

  test('flags a missing date and prefills a placeholder', () => {
    const d = diagnoseGuess('Luleå - Linköping utan resultat alls', 2023);
    assert.strictEqual(d.complete, false);
    assert.strictEqual(d.found.date, false);
    assert.strictEqual(d.found.score, false);
    assert.ok(d.suggestion.startsWith('ÅÅÅÅ-MM-DD,'));
  });

  test('recovers a malformed date with stray spaces for the suggestion', () => {
    const d = diagnoseGuess('2023 -10 -21, Skellefteå - Luleå: 2 - 1, Zeb Forsberg....men nej', 2023);
    assert.strictEqual(d.found.date, true);
    assert.ok(d.suggestion.startsWith('2023-10-21,'));
    assert.strictEqual(d.found.teams, true);
    assert.strictEqual(d.found.score, true);
  });

  test('extracts pieces around quoted chatter without a valid date', () => {
    const d = diagnoseGuess('Vem vinner? Luleå - Timrå blir nog 3-2, Omark', 2023);
    assert.strictEqual(d.complete, false);
    assert.strictEqual(d.found.score, true);
    assert.strictEqual(d.found.scorer, true);
    assert.ok(d.suggestion.includes('3-2'));
    assert.ok(d.suggestion.includes('Omark'));
  });
});
