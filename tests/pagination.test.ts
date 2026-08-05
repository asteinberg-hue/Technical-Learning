import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LIMIT, MAX_LIMIT, paginate, parseLimit } from '../src/api/pagination.ts';
import { ApiError } from '../src/api/errors.ts';

test('parseLimit defaults, clamps, and validates', () => {
  assert.equal(parseLimit(null), DEFAULT_LIMIT);
  assert.equal(parseLimit('10'), 10);
  assert.equal(parseLimit('9999'), MAX_LIMIT);
  assert.throws(() => parseLimit('0'), ApiError);
  assert.throws(() => parseLimit('-3'), ApiError);
  assert.throws(() => parseLimit('abc'), ApiError);
});

test('paginate walks a collection page by page', () => {
  const items = [1, 2, 3, 4, 5];
  const first = paginate(items, null, 2);
  assert.deepEqual(first.items, [1, 2]);
  assert.notEqual(first.nextCursor, null);

  const second = paginate(items, first.nextCursor, 2);
  assert.deepEqual(second.items, [3, 4]);

  const third = paginate(items, second.nextCursor, 2);
  assert.deepEqual(third.items, [5]);
  assert.equal(third.nextCursor, null);
});

test('paginate rejects a malformed cursor', () => {
  assert.throws(() => paginate([1, 2, 3], 'not-a-valid-cursor!!', 2), ApiError);
});
