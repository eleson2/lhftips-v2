import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  VERDICT,
  verdictKey,
  setVerdict,
  removeVerdict,
  findVerdict,
  verdictOverride,
} from '../src/utils/scorer-verdicts.js';
import { checkScorer, calculateScore } from '../src/utils/scoring.js';
import { plausibleLink } from '../src/parsers/ai/ollama-provider.js';

const empty = () => ({ version: 1, verdicts: {} });

const IDENT = {
  username: 'HarryHaffa',
  date: '2023-02-02',
  homeTeam: 'Luleå HF',
  awayTeam: 'Linköping HC',
};

describe('verdictKey', () => {
  test('is case- and whitespace-insensitive', () => {
    assert.strictEqual(
      verdictKey({ username: 'HarryHaffa', date: '2023-02-02', homeTeam: 'Luleå HF', awayTeam: 'Linköping HC' }),
      verdictKey({ username: '  harryhaffa ', date: '2023-02-02', homeTeam: 'luleå  hf', awayTeam: 'LINKÖPING HC' })
    );
  });

  test('distinguishes different users on the same match', () => {
    assert.notStrictEqual(
      verdictKey({ ...IDENT, username: 'A' }),
      verdictKey({ ...IDENT, username: 'B' })
    );
  });
});

describe('setVerdict / findVerdict', () => {
  test('round-trips a verdict', () => {
    const store = empty();
    setVerdict(store, { ...IDENT, guessedScorer: 'Tyrre', verdict: VERDICT.CORRECT, resolvedTo: 'Linus Nässén', note: 'confirmed' });
    const { verdict, stale } = findVerdict(store, { ...IDENT, guessedScorer: 'Tyrre' });
    assert.strictEqual(stale, false);
    assert.strictEqual(verdict.verdict, 'correct');
    assert.strictEqual(verdict.resolvedTo, 'Linus Nässén');
    assert.strictEqual(verdict.note, 'confirmed');
    assert.ok(verdict.decidedAt, 'stamps a decision time for the audit trail');
  });

  test('returns nothing for a guess with no verdict', () => {
    const { verdict, stale } = findVerdict(empty(), { ...IDENT, guessedScorer: 'Tyrre' });
    assert.strictEqual(verdict, null);
    assert.strictEqual(stale, false);
  });

  test('matches the stored spelling regardless of case and accents', () => {
    const store = empty();
    setVerdict(store, { ...IDENT, guessedScorer: 'Brännström', verdict: VERDICT.CORRECT });
    assert.ok(findVerdict(store, { ...IDENT, guessedScorer: 'brannstrom' }).verdict);
  });

  test('a verdict does NOT carry over when the guess is edited to another name', () => {
    const store = empty();
    setVerdict(store, { ...IDENT, guessedScorer: 'Tyrre', verdict: VERDICT.CORRECT });
    const found = findVerdict(store, { ...IDENT, guessedScorer: 'Shinnimin' });
    assert.strictEqual(found.verdict, null, 'must not silently apply to a different player');
    assert.strictEqual(found.stale, true, 'and must be re-surfaced for review');
  });

  test('rejects an unknown verdict value', () => {
    assert.throws(
      () => setVerdict(empty(), { ...IDENT, guessedScorer: 'X', verdict: 'maybe' }),
      /Unknown verdict/
    );
  });

  test('removeVerdict reports whether anything was there', () => {
    const store = empty();
    const key = verdictKey(IDENT);
    setVerdict(store, { ...IDENT, guessedScorer: 'Tyrre', verdict: VERDICT.CORRECT });
    assert.strictEqual(removeVerdict(store, key), true);
    assert.strictEqual(removeVerdict(store, key), false);
    assert.strictEqual(findVerdict(store, { ...IDENT, guessedScorer: 'Tyrre' }).verdict, null);
  });
});

describe('checkScorer with a human verdict', () => {
  const actual = ['Isac Brännström', 'Pontus Andreasson'];

  test('awards the point on a "correct" verdict the matcher would have refused', () => {
    assert.strictEqual(checkScorer('Brasse', actual), 0, 'matcher alone finds nothing');
    assert.strictEqual(checkScorer('Brasse', actual, 'correct'), 1);
  });

  test('withholds the point on an "incorrect" verdict the matcher would have awarded', () => {
    assert.strictEqual(checkScorer('Brännström', actual), 1, 'matcher alone awards it');
    assert.strictEqual(checkScorer('Brännström', actual, 'incorrect'), 0);
  });

  test('falls back to the matcher when there is no verdict', () => {
    assert.strictEqual(checkScorer('Brännström', actual, null), 1);
    assert.strictEqual(checkScorer('Zetterberg', actual, null), 0);
  });

  test('a "correct" verdict still needs actual goalscorers to be beaten by nothing else', () => {
    // Verdict wins outright — that is the point of it.
    assert.strictEqual(checkScorer('anything', [], 'correct'), 1);
  });
});

describe('calculateScore threads the override through', () => {
  const match = { home_score: 2, away_score: 3, lulea_is_home: false, home_team: 'HV71', away_team: 'Luleå HF' };
  const guess = { predicted_home_score: 2, predicted_away_score: 3, predicted_scorer: 'Brasse' };
  const actual = ['Isac Brännström'];

  test('without a verdict the scorer point is withheld', () => {
    const s = calculateScore(guess, match, actual);
    assert.strictEqual(s.scorer, 0);
  });

  test('with a correct verdict the scorer point lands in the total', () => {
    const without = calculateScore(guess, match, actual);
    const with_ = calculateScore(guess, match, actual, 'correct');
    assert.strictEqual(with_.scorer, 1);
    assert.strictEqual(with_.total, without.total + 1);
  });
});

describe('verdictOverride', () => {
  test('maps a verdict record to the override the scorer takes', () => {
    assert.strictEqual(verdictOverride(null), null);
    assert.strictEqual(verdictOverride({ verdict: 'correct' }), 'correct');
    assert.strictEqual(verdictOverride({ verdict: 'incorrect' }), 'incorrect');
  });
});

describe('plausibleLink — the guard on AI proposals', () => {
  test('accepts real Swedish nickname forms', () => {
    assert.ok(plausibleLink('Brasse', 'Isac Brännström'));
    assert.ok(plausibleLink('Södde', 'Linus Söderberg'));
    assert.ok(plausibleLink('Lindis', 'Anton Lindgren'));
    assert.ok(plausibleLink('Kalle', 'Erik Karlsson'));
  });

  test('accepts surnames and first names, accented or not', () => {
    assert.ok(plausibleLink('Brannstrom', 'Isac Brännström'));
    assert.ok(plausibleLink('Einar', 'Einar Emanuelsson'));
  });

  test('rejects a proposal sharing no opening letters — the confabulation case', () => {
    assert.strictEqual(plausibleLink('Zetterberg', 'Linus Nässén'), false);
    assert.strictEqual(plausibleLink('Puckdrottningen', 'Linus Nässén'), false);
    assert.strictEqual(plausibleLink('Nisse', 'Linus Nässén'), false);
  });

  test('rejects input with nothing to compare, such as a bare jersey number', () => {
    assert.strictEqual(plausibleLink('17', 'Isac Brännström'), false);
    assert.strictEqual(plausibleLink('', 'Isac Brännström'), false);
  });
});
