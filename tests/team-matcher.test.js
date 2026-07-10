import { test, describe } from 'node:test';
import assert from 'node:assert';
import { matchTeam, isLulea } from '../src/utils/team-matcher.js';

describe('matchTeam', () => {
  test('matches exact canonical name', () => {
    assert.strictEqual(matchTeam('Luleå HF'), 'Luleå HF');
  });

  test('matches common abbreviation LHF', () => {
    assert.strictEqual(matchTeam('LHF'), 'Luleå HF');
  });

  test('matches Luleå without suffix', () => {
    assert.strictEqual(matchTeam('Luleå'), 'Luleå HF');
  });

  test('matches case-insensitively', () => {
    assert.strictEqual(matchTeam('luleå'), 'Luleå HF');
    assert.strictEqual(matchTeam('LULEÅ'), 'Luleå HF');
  });

  test('matches Skellefteå variations', () => {
    assert.strictEqual(matchTeam('Skellefteå'), 'Skellefteå AIK');
    assert.strictEqual(matchTeam('SAIK'), 'Skellefteå AIK');
    assert.strictEqual(matchTeam('Skansen'), 'Skellefteå AIK');
  });

  test('matches Frölunda variations', () => {
    assert.strictEqual(matchTeam('Frölunda'), 'Frölunda HC');
    assert.strictEqual(matchTeam('FHC'), 'Frölunda HC');
  });

  test('matches IK Oskarshamn variations', () => {
    assert.strictEqual(matchTeam('Oskarshamn'), 'IK Oskarshamn');
    assert.strictEqual(matchTeam('IKO'), 'IK Oskarshamn');
  });

  test('fuzzy matches close misspellings', () => {
    // These should still match due to fuzzy matching
    assert.strictEqual(matchTeam('Lulea'), 'Luleå HF');
    assert.strictEqual(matchTeam('Frolunda'), 'Frölunda HC');
  });

  test('returns original for unknown team', () => {
    assert.strictEqual(matchTeam('Unknown Team'), 'Unknown Team');
  });

  test('handles null and empty input', () => {
    assert.strictEqual(matchTeam(null), null);
    assert.strictEqual(matchTeam(''), null);
  });
});

describe('isLulea', () => {
  test('returns true for Luleå HF', () => {
    assert.strictEqual(isLulea('Luleå HF'), true);
  });

  test('returns true for LHF', () => {
    assert.strictEqual(isLulea('LHF'), true);
  });

  test('returns true for Luleå', () => {
    assert.strictEqual(isLulea('Luleå'), true);
  });

  test('returns true for Lansen', () => {
    assert.strictEqual(isLulea('Lansen'), true);
  });

  test('returns false for other teams', () => {
    assert.strictEqual(isLulea('Skellefteå AIK'), false);
    assert.strictEqual(isLulea('Frölunda HC'), false);
  });
});
