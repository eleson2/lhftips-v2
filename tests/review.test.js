import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ReviewCollector, REVIEW } from '../src/utils/review.js';

describe('ReviewCollector', () => {
  test('counts items by reason', () => {
    const rc = new ReviewCollector();
    rc.add(REVIEW.SCORER_UNMATCHED, { username: 'a', date: '2026-10-01' });
    rc.add(REVIEW.SCORER_UNMATCHED, { username: 'b', date: '2026-10-02' });
    rc.add(REVIEW.DATE_NO_FIXTURE, { username: 'c', date: '2026-10-03' });
    assert.strictEqual(rc.count, 3);
    assert.deepStrictEqual(rc.countsByReason(), {
      [REVIEW.SCORER_UNMATCHED]: 2,
      [REVIEW.DATE_NO_FIXTURE]: 1,
    });
  });

  test('empty collector reports zero', () => {
    const rc = new ReviewCollector();
    assert.strictEqual(rc.count, 0);
    assert.deepStrictEqual(rc.countsByReason(), {});
  });
});
