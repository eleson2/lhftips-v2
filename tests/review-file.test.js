import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parseCommentLine, listPending, applyFix, applyDismiss, MARK_FIXED, MARK_DISMISSED
} from '../src/utils/review-file.js';

describe('parseCommentLine', () => {
  test('parses a legacy comment line (no timestamp)', () => {
    const r = parseCommentLine('#NallePhu: 2023-09-14, Oskarshamn - Luleå, 2-5 Shinnimin');
    assert.ok(r);
    assert.strictEqual(r.username, 'NallePhu');
    assert.strictEqual(r.timestamp, null);
    assert.strictEqual(r.content, '2023-09-14, Oskarshamn - Luleå, 2-5 Shinnimin');
  });

  test('parses a comment line with embedded post timestamp', () => {
    const r = parseCommentLine('#Lasse Proppmätt @2026-09-19T18:34:00: some unparsed text');
    assert.ok(r);
    assert.strictEqual(r.username, 'Lasse Proppmätt');
    assert.strictEqual(r.timestamp, '2026-09-19T18:34:00');
    assert.strictEqual(r.content, 'some unparsed text');
  });

  test('content containing colons does not confuse the split', () => {
    const r = parseCommentLine('#Urken: Senaste matchen slutade: 2-5. Målskyttar: Andersson');
    assert.ok(r);
    assert.strictEqual(r.username, 'Urken');
    assert.strictEqual(r.content, 'Senaste matchen slutade: 2-5. Målskyttar: Andersson');
  });

  test('returns null for handled lines and non-comments', () => {
    assert.strictEqual(parseCommentLine('#[fixed]NallePhu: text'), null);
    assert.strictEqual(parseCommentLine('#[dismissed]Urken: text'), null);
    assert.strictEqual(parseCommentLine('Rönken,2023-09-14T18:34:00,2023-09-14,...'), null);
    assert.strictEqual(parseCommentLine(''), null);
  });
});

describe('listPending', () => {
  const lines = [
    'username,timestamp,date,home_team,away_team,home_score,away_score,scorer,raw_text',
    'Rönken,2023-09-14T18:34:00,2023-09-14,IK Oskarshamn,Luleå HF,1,3,Omark,"..."',
    '#NallePhu: unparsed guess text',
    '#[fixed]Urken: already fixed text',
    'Urken,,2023-09-16,Luleå HF,Timrå IK,4,3,Andersson,"..."',
    '#[dismissed]Metheuz: chatter',
    '#Sponsored content: window._taboola = ...',
    '#Redbear: another pending one'
  ];

  test('lists only pending, non-sponsored comment lines with their indexes', () => {
    const items = listPending(lines);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].index, 2);
    assert.strictEqual(items[0].username, 'NallePhu');
    assert.strictEqual(items[1].index, 7);
    assert.strictEqual(items[1].username, 'Redbear');
  });
});

describe('applyFix', () => {
  const lines = ['header', '#NallePhu: 2-5 utan datum', 'existing,row'];

  test('marks the comment as fixed and inserts rows directly below it', () => {
    const out = applyFix(lines, 1, '#NallePhu: 2-5 utan datum', ['NallePhu,,2026-09-19,...']);
    assert.strictEqual(out[1], MARK_FIXED + 'NallePhu: 2-5 utan datum');
    assert.strictEqual(out[2], 'NallePhu,,2026-09-19,...');
    assert.strictEqual(out[3], 'existing,row');
    assert.strictEqual(out.length, 4);
    // input untouched
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[1], '#NallePhu: 2-5 utan datum');
  });

  test('supports inserting multiple rows for multi-guess posts', () => {
    const out = applyFix(lines, 1, '#NallePhu: 2-5 utan datum', ['row1', 'row2']);
    assert.deepStrictEqual(out.slice(2, 4), ['row1', 'row2']);
  });

  test('throws if the line changed since it was loaded', () => {
    assert.throws(
      () => applyFix(lines, 1, '#NallePhu: something else', ['row']),
      /has changed/
    );
  });
});

describe('applyDismiss', () => {
  test('marks the comment as dismissed without inserting anything', () => {
    const lines = ['header', '#Urken: chatter', 'row'];
    const out = applyDismiss(lines, 1, '#Urken: chatter');
    assert.strictEqual(out[1], MARK_DISMISSED + 'Urken: chatter');
    assert.strictEqual(out.length, 3);
  });
});
