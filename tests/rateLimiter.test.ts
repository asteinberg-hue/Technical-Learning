import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../src/api/rateLimiter.ts';

test('allows up to the limit, then blocks within the window', () => {
  const limiter = new RateLimiter(3, 60_000);
  const t0 = new Date('2026-08-05T20:30:00.000Z');

  assert.equal(limiter.check('k', t0).allowed, true);
  assert.equal(limiter.check('k', t0).allowed, true);
  const third = limiter.check('k', t0);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const fourth = limiter.check('k', t0);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
});

test('resets after the window elapses', () => {
  const limiter = new RateLimiter(1, 60_000);
  const t0 = new Date('2026-08-05T20:30:00.000Z');
  assert.equal(limiter.check('k', t0).allowed, true);
  assert.equal(limiter.check('k', t0).allowed, false);

  const later = new Date(t0.getTime() + 60_000);
  assert.equal(limiter.check('k', later).allowed, true);
});

test('tracks keys independently', () => {
  const limiter = new RateLimiter(1, 60_000);
  const t0 = new Date('2026-08-05T20:30:00.000Z');
  assert.equal(limiter.check('a', t0).allowed, true);
  assert.equal(limiter.check('b', t0).allowed, true);
});
