import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import {
  CORRECTION,
  correctionKey,
  setCorrection,
  removeCorrection,
  findCorrection,
  applyCorrection,
  loadCorrections,
  saveCorrections,
} from '../src/utils/guess-corrections.js';
import { correctGuess } from '../src/commands/correct-guess.js';

const empty = () => ({ version: 1, corrections: {} });

const POST = {
  username: 'Urken',
  timestamp: '2026-10-01T18:30:00',
  content: 'luleå hv71 fyra ett nisse',
  postId: 4711,
};

const FIXED_ROW = 'Urken,2026-10-01T18:30:00,2026-10-01,Luleå HF,HV71,4,1,Nisse,manually fixed';

describe('correctionKey', () => {
  test('is case- and whitespace-insensitive', () => {
    assert.strictEqual(
      correctionKey('Urken', '2026-10-01T18:30:00'),
      correctionKey('  urken ', ' 2026-10-01T18:30:00 ')
    );
  });

  test('separates two posts by the same user', () => {
    assert.notStrictEqual(
      correctionKey('Urken', '2026-10-01T18:30:00'),
      correctionKey('Urken', '2026-10-04T18:30:00')
    );
  });
});

describe('recording corrections', () => {
  test('a fixed correction round-trips', () => {
    const store = empty();
    setCorrection(store, {
      username: POST.username, timestamp: POST.timestamp,
      kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content,
    });
    const { correction, stale } = findCorrection(store, POST);
    assert.strictEqual(stale, false);
    assert.strictEqual(correction.kind, 'fixed');
    assert.deepStrictEqual(correction.rows, [FIXED_ROW]);
    assert.ok(correction.decidedAt);
  });

  test('a dismissal stores no rows', () => {
    const store = empty();
    setCorrection(store, {
      username: POST.username, timestamp: POST.timestamp,
      kind: CORRECTION.DISMISSED, rows: [FIXED_ROW], originalText: POST.content,
    });
    assert.deepStrictEqual(findCorrection(store, POST).correction.rows, []);
  });

  test('refuses a fix with nothing to substitute', () => {
    assert.throws(
      () => setCorrection(empty(), { username: 'a', timestamp: 'b', kind: CORRECTION.FIXED, rows: [] }),
      /needs at least one replacement row/
    );
  });

  test('refuses an unknown kind', () => {
    assert.throws(
      () => setCorrection(empty(), { username: 'a', timestamp: 'b', kind: 'maybe' }),
      /Unknown correction kind/
    );
  });

  test('removeCorrection reports whether anything was there', () => {
    const store = empty();
    const key = correctionKey(POST.username, POST.timestamp);
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    assert.strictEqual(removeCorrection(store, key), true);
    assert.strictEqual(removeCorrection(store, key), false);
  });
});

describe('staleness — a correction is tied to the text it was made about', () => {
  test('ignores whitespace and case differences', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    const found = findCorrection(store, { ...POST, content: '  LULEÅ   HV71 fyra ett NISSE ' });
    assert.strictEqual(found.stale, false);
    assert.ok(found.correction);
  });

  test('does NOT apply when the poster edited their post to say something else', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    const found = findCorrection(store, { ...POST, content: 'luleå hv71 två tre brännström' });
    assert.strictEqual(found.correction, null);
    assert.strictEqual(found.stale, true);
  });

  test('applies without complaint when no original text was captured', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: '' });
    assert.ok(findCorrection(store, POST).correction);
  });
});

describe('applyCorrection — what the scraper actually does', () => {
  test('passes parser output through untouched when nothing is recorded', () => {
    const parsed = ['some,parsed,row'];
    const r = applyCorrection(POST, parsed, empty());
    assert.deepStrictEqual(r.rows, parsed);
    assert.strictEqual(r.applied, false);
  });

  test('substitutes the corrected rows for what the parser produced', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    const r = applyCorrection(POST, ['wrong,row,from,parser'], store);
    assert.deepStrictEqual(r.rows, [FIXED_ROW]);
    assert.strictEqual(r.applied, true);
  });

  test('substitutes even when the parser produced nothing at all', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    const r = applyCorrection(POST, [], store);
    assert.deepStrictEqual(r.rows, [FIXED_ROW], 'this is the --fresh case: the fix must come back');
  });

  test('a dismissal yields no rows and is not re-raised for review', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.DISMISSED, originalText: POST.content });
    const r = applyCorrection(POST, ['parser,made,something'], store);
    assert.deepStrictEqual(r.rows, []);
    assert.strictEqual(r.dismissed, true);
  });

  test('falls back to the parser, flagged, when the post text moved under the correction', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    const r = applyCorrection({ ...POST, content: 'completely different now' }, ['parser,row'], store);
    assert.deepStrictEqual(r.rows, ['parser,row'], 'must not apply a ruling made about other text');
    assert.strictEqual(r.stale, true);
    assert.strictEqual(r.applied, false);
  });

  test('returned rows are a copy — the caller cannot mutate the store', () => {
    const store = empty();
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    const r = applyCorrection(POST, [], store);
    r.rows.push('injected');
    assert.deepStrictEqual(findCorrection(store, POST).correction.rows, [FIXED_ROW]);
  });
});

describe('persistence', () => {
  const path = join(tmpdir(), `lhftips-corrections-${process.pid}.json`);

  test('survives a save/load round trip with sorted keys', () => {
    if (existsSync(path)) rmSync(path);
    const store = empty();
    setCorrection(store, { username: 'Zeta', timestamp: '2026-10-09T10:00:00', kind: CORRECTION.DISMISSED });
    setCorrection(store, { ...POST, kind: CORRECTION.FIXED, rows: [FIXED_ROW], originalText: POST.content });
    saveCorrections(store, path);

    const back = loadCorrections(path);
    assert.strictEqual(Object.keys(back.corrections).length, 2);
    assert.deepStrictEqual(Object.keys(back.corrections), Object.keys(back.corrections).slice().sort());
    assert.deepStrictEqual(findCorrection(back, POST).correction.rows, [FIXED_ROW]);
    rmSync(path);
  });

  test('a missing file is an empty store, not a crash', () => {
    const store = loadCorrections(join(tmpdir(), 'lhftips-does-not-exist.json'));
    assert.deepStrictEqual(store.corrections, {});
  });
});

describe('correct date — fixing one mistyped date everywhere at once', () => {
  const csv = join(tmpdir(), `lhftips-bulk-${process.pid}.csv`);
  const header = 'username,timestamp,date,home_team,away_team,home_score,away_score,scorer,raw_text';

  const write = () => writeFileSync(csv, [
    header,
    'Redbear,2023-09-28T17:12:00,2023-09-08,Luleå HF,HV71,5,1,Tyrväinen,"2023-09-08, Luleå-HV71, 5-1, Tyrväinen"',
    'PM,2023-09-28T18:00:00,2023-09-08,Luleå HF,HV71,3,2,Omark,"2023-09-08, Luleå-HV71, 3-2, Omark"',
    'Other,2023-10-01T18:00:00,2023-10-01,Luleå HF,Rögle BK,2,1,Nässén,untouched',
  ].join('\n'));

  test('rewrites every row carrying that date, and nothing else', async () => {
    write();
    const o = console.log; console.log = () => {};
    await correctGuess('date', '2023-09-08', '2023-09-28', null, { file: csv });
    console.log = o;

    const out = readFileSync(csv, 'utf-8');
    assert.ok(!out.includes(',2023-09-08,'), 'the typo is gone from the date column');
    assert.strictEqual((out.match(/,2023-09-28,/g) || []).length, 2);
    assert.ok(out.includes('untouched'), 'unrelated rows are left alone');
    assert.ok(out.includes('"2023-09-08, Luleå-HV71, 5-1, Tyrväinen"'), 'raw_text keeps the original typo for audit');
    rmSync(csv);
  });

  test('records one durable correction per affected post', async () => {
    write();
    const o = console.log; console.log = () => {};
    await correctGuess('date', '2023-09-08', '2023-09-28', null, { file: csv });
    console.log = o;

    const store = loadCorrections();
    assert.ok(findCorrection(store, { username: 'Redbear', timestamp: '2023-09-28T17:12:00' }).correction);
    assert.ok(findCorrection(store, { username: 'PM', timestamp: '2023-09-28T18:00:00' }).correction);
    assert.strictEqual(
      findCorrection(store, { username: 'Other', timestamp: '2023-10-01T18:00:00' }).correction,
      null,
      'an untouched row gets no correction record'
    );
    rmSync(csv);
  });

  test('says so and changes nothing when that date is not present', async () => {
    write();
    const o = console.log; const said = [];
    console.log = (...a) => said.push(a.join(' '));
    await correctGuess('date', '1999-01-01', '2023-09-28', null, { file: csv });
    console.log = o;
    assert.ok(said.join('\n').includes('No rows carry the date'));
    rmSync(csv);
  });
});
