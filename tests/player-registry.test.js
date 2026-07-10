import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  generateVariants,
  mergeRoster,
  learnVariation,
  buildLookup,
} from '../src/utils/player-registry.js';

describe('generateVariants', () => {
  test('derives surname and initial+surname, accented and folded', () => {
    const v = generateVariants('Isac Brännström');
    assert.ok(v.includes('brännström'));
    assert.ok(v.includes('brannstrom'));
    assert.ok(v.includes('i. brännström'));
    assert.ok(v.includes('i. brannstrom'));
    assert.ok(v.includes('i brännström'));
  });

  test('handles hyphenated surnames', () => {
    const v = generateVariants('Jakob Ihs-Wozniak');
    assert.ok(v.includes('ihs-wozniak'));
    assert.ok(v.includes('j. ihs-wozniak'));
  });

  test('handles single-token names without crashing', () => {
    const v = generateVariants('Omark');
    assert.ok(v.includes('omark'));
  });
});

function freshRegistry() {
  return { season: null, players: {} };
}

describe('mergeRoster', () => {
  const roster = [
    { number: 17, name: 'Isac Brännström', position: 'forward' },
    { number: 34, name: 'Joel Lassinantti', position: 'goalie' },
  ];

  test('adds new players on first sync', () => {
    const reg = freshRegistry();
    const { diff } = mergeRoster(reg, roster, { mode: 'in-season', season: '2026-27' });
    assert.strictEqual(diff.added.length, 2);
    assert.strictEqual(reg.players['Isac Brännström'].active, true);
    assert.deepStrictEqual(reg.players['Isac Brännström'].seasonsActive, ['2026-27']);
  });

  test('in-season never deactivates a departed player', () => {
    const reg = freshRegistry();
    mergeRoster(reg, roster, { mode: 'in-season', season: '2026-27' });
    // Next sync: Lassinantti gone from roster
    const { diff } = mergeRoster(reg, [roster[0]], { mode: 'in-season', season: '2026-27' });
    assert.strictEqual(reg.players['Joel Lassinantti'].active, true, 'still active in-season');
    assert.strictEqual(diff.deactivated.length, 0);
  });

  test('new-season deactivates departed players but keeps them', () => {
    const reg = freshRegistry();
    mergeRoster(reg, roster, { mode: 'in-season', season: '2026-27' });
    const { diff } = mergeRoster(reg, [roster[0]], { mode: 'new-season', season: '2027-28' });
    assert.strictEqual(reg.players['Joel Lassinantti'].active, false);
    assert.ok('Joel Lassinantti' in reg.players, 'kept, never deleted');
    assert.ok(diff.deactivated.includes('Joel Lassinantti'));
  });

  test('new-season carries over a returning player and their learned variations', () => {
    const reg = freshRegistry();
    mergeRoster(reg, [roster[0]], { mode: 'in-season', season: '2026-27' });
    learnVariation(reg, 'Isac Brännström', 'brasse', { game: 1, date: '2026-10-01' });
    // deactivate then reactivate next season
    mergeRoster(reg, [], { mode: 'new-season', season: '2027-28' });
    assert.strictEqual(reg.players['Isac Brännström'].active, false);
    const { diff } = mergeRoster(reg, [roster[0]], { mode: 'new-season', season: '2027-28' });
    assert.ok(diff.returning.includes('Isac Brännström'));
    assert.strictEqual(reg.players['Isac Brännström'].active, true);
    assert.ok(
      reg.players['Isac Brännström'].learned.some((l) => l.variation === 'brasse'),
      'learned variation preserved across seasons'
    );
  });
});

describe('learnVariation', () => {
  test('adds a new spelling with provenance', () => {
    const reg = freshRegistry();
    mergeRoster(reg, [{ number: 17, name: 'Isac Brännström', position: 'forward' }], {
      mode: 'in-season', season: '2026-27',
    });
    const added = learnVariation(reg, 'Isac Brännström', 'brasse', { game: 5, date: '2026-11-01' });
    assert.strictEqual(added, true);
    const learned = reg.players['Isac Brännström'].learned;
    assert.strictEqual(learned.length, 1);
    assert.strictEqual(learned[0].game, 5);
  });

  test('does not add a spelling already known as a variation', () => {
    const reg = freshRegistry();
    mergeRoster(reg, [{ number: 17, name: 'Isac Brännström', position: 'forward' }], {
      mode: 'in-season', season: '2026-27',
    });
    // "brännström" is already a deterministic variation
    const added = learnVariation(reg, 'Isac Brännström', 'Brännström', {});
    assert.strictEqual(added, false);
  });
});

describe('buildLookup', () => {
  test('resolves a variation to its canonical', () => {
    const reg = freshRegistry();
    mergeRoster(reg, [{ number: 17, name: 'Isac Brännström', position: 'forward' }], {
      mode: 'in-season', season: '2026-27',
    });
    const { map } = buildLookup(reg);
    assert.strictEqual(map.get('brannstrom'), 'Isac Brännström');
  });

  test('flags a surname shared by two players as ambiguous', () => {
    const reg = freshRegistry();
    mergeRoster(
      reg,
      [
        { number: 1, name: 'Erik Eriksson', position: 'forward' },
        { number: 2, name: 'Filip Eriksson', position: 'forward' },
      ],
      { mode: 'in-season', season: '2026-27' }
    );
    const { map, AMBIGUOUS } = buildLookup(reg);
    assert.strictEqual(map.get('eriksson'), AMBIGUOUS);
    // but the full names still resolve uniquely
    assert.strictEqual(map.get('erik eriksson'), 'Erik Eriksson');
  });
});
