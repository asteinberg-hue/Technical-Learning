import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Authenticator, resolveSiteScope } from '../src/api/auth.ts';
import { ApiError } from '../src/api/errors.ts';

const auth = new Authenticator([
  { apiKey: 'all-key', accountId: 'acct_a', authorizedSiteIds: 'all' },
  { apiKey: 'east-key', accountId: 'acct_a', authorizedSiteIds: ['east'] },
]);

test('authenticate rejects missing or malformed headers', () => {
  assert.throws(() => auth.authenticate(undefined), ApiError);
  assert.throws(() => auth.authenticate('Basic abc'), ApiError);
  assert.throws(() => auth.authenticate('Bearer '), ApiError);
});

test('authenticate rejects unknown keys but accepts known ones', () => {
  assert.throws(() => auth.authenticate('Bearer nope'), ApiError);
  const ctx = auth.authenticate('Bearer all-key');
  assert.equal(ctx.accountId, 'acct_a');
  assert.equal(ctx.authorizedSiteIds, undefined); // account-wide
});

test('resolveSiteScope forbids cross-account access', () => {
  const ctx = auth.authenticate('Bearer all-key');
  assert.throws(() => resolveSiteScope(ctx, 'acct_b', undefined), (err: unknown) => {
    return err instanceof ApiError && err.status === 403;
  });
});

test('resolveSiteScope honors a request filter for an account-wide key', () => {
  const ctx = auth.authenticate('Bearer all-key');
  const scope = resolveSiteScope(ctx, 'acct_a', ['west']);
  assert.deepEqual([...scope!], ['west']);
});

test('resolveSiteScope restricts a scoped key to its sites', () => {
  const ctx = auth.authenticate('Bearer east-key');
  const scope = resolveSiteScope(ctx, 'acct_a', undefined);
  assert.deepEqual([...scope!], ['east']);
});

test('resolveSiteScope rejects a scoped key asking for a forbidden site', () => {
  const ctx = auth.authenticate('Bearer east-key');
  assert.throws(() => resolveSiteScope(ctx, 'acct_a', ['west']), (err: unknown) => {
    return err instanceof ApiError && err.status === 403;
  });
});
