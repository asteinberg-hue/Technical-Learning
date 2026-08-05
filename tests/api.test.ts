import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { Authenticator } from '../src/api/auth.ts';
import { RateLimiter } from '../src/api/rateLimiter.ts';
import { createServer, handleRoute, type RouterDeps } from '../src/api/router.ts';
import { TelemetryStore } from '../src/store/telemetryStore.ts';
import { buildSeedData } from '../src/data/seed.ts';
import { DEMO_CREDENTIALS } from '../src/config.ts';

const NOW = new Date('2026-08-05T20:30:00.000Z');

function makeDeps(): RouterDeps {
  return {
    store: new TelemetryStore(buildSeedData(NOW)),
    authenticator: new Authenticator(DEMO_CREDENTIALS),
    rateLimiter: new RateLimiter(1000, 60_000),
    now: () => NOW,
  };
}

function get(deps: RouterDeps, path: string, apiKey?: string) {
  const headers = apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` };
  return handleRoute(deps, 'GET', path, headers);
}

test('healthz needs no auth', () => {
  const res = get(makeDeps(), '/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { status: string }).status, 'ok');
});

test('missing credentials → 401', () => {
  const res = get(makeDeps(), '/v1/accounts/acct_wareex/telemetry/rollup');
  assert.equal(res.status, 401);
});

test('wrong account for a key → 403', () => {
  const res = get(makeDeps(), '/v1/accounts/acct_northwind/telemetry/rollup', 'wareex-demo-key');
  assert.equal(res.status, 403);
});

test('account-wide rollup aggregates all sites and is degraded', () => {
  const res = get(makeDeps(), '/v1/accounts/acct_wareex/telemetry/rollup', 'wareex-demo-key');
  assert.equal(res.status, 200);
  const body = res.body as { siteCount: number; robotCount: number; health: string };
  assert.equal(body.siteCount, 2);
  assert.equal(body.robotCount, 5);
  assert.equal(body.health, 'degraded');
  assert.equal(res.headers['x-ratelimit-limit'], '1000');
});

test('a site-scoped key only ever sees its site', () => {
  const res = get(makeDeps(), '/v1/accounts/acct_wareex/telemetry/rollup', 'wareex-east-only-key');
  const body = res.body as { siteCount: number; robotCount: number; sites: { siteId: string }[] };
  assert.equal(body.siteCount, 1);
  assert.equal(body.robotCount, 3);
  assert.deepEqual(
    body.sites.map((s) => s.siteId),
    ['wareex_east'],
  );
});

test('a site-scoped key cannot read a robot outside its scope', () => {
  const deps = makeDeps();
  // wx-w-01 lives at wareex_west; the east-only key must not see it.
  const res = get(deps, '/v1/accounts/acct_wareex/robots/wx-w-01', 'wareex-east-only-key');
  assert.equal(res.status, 404);
  // ...but the account-wide key can.
  const ok = get(deps, '/v1/accounts/acct_wareex/robots/wx-w-01', 'wareex-demo-key');
  assert.equal(ok.status, 200);
  assert.equal((ok.body as { health: { state: string } }).health.state, 'stale');
});

test('robot listing supports state filter and cursor pagination', () => {
  const deps = makeDeps();
  const errored = get(deps, '/v1/accounts/acct_wareex/robots?state=error', 'wareex-demo-key');
  const erroredBody = errored.body as { robots: { robotId: string }[] };
  assert.deepEqual(
    erroredBody.robots.map((r) => r.robotId),
    ['wx-w-02'],
  );

  const firstPage = get(deps, '/v1/accounts/acct_wareex/robots?limit=2', 'wareex-demo-key');
  const firstBody = firstPage.body as { robots: unknown[]; nextCursor: string | null };
  assert.equal(firstBody.robots.length, 2);
  assert.notEqual(firstBody.nextCursor, null);

  const secondPage = get(
    deps,
    `/v1/accounts/acct_wareex/robots?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    'wareex-demo-key',
  );
  assert.equal((secondPage.body as { robots: unknown[] }).robots.length, 2);
});

test('unknown robot → 404', () => {
  const res = get(makeDeps(), '/v1/accounts/acct_wareex/robots/does-not-exist', 'wareex-demo-key');
  assert.equal(res.status, 404);
});

test('rate limiting returns 429 once the window budget is spent', () => {
  const deps: RouterDeps = { ...makeDeps(), rateLimiter: new RateLimiter(2, 60_000) };
  assert.equal(get(deps, '/v1/accounts/acct_wareex/sites', 'wareex-demo-key').status, 200);
  assert.equal(get(deps, '/v1/accounts/acct_wareex/sites', 'wareex-demo-key').status, 200);
  const blocked = get(deps, '/v1/accounts/acct_wareex/sites', 'wareex-demo-key');
  assert.equal(blocked.status, 429);
  assert.equal((blocked.body as { error: { code: string } }).error.code, 'rate_limited');
});

test('end-to-end over real HTTP', async () => {
  const server = createServer(makeDeps());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://localhost:${port}/v1/accounts/acct_intellifleet/telemetry/rollup`, {
      headers: { authorization: 'Bearer intellifleet-demo-key' },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { accountId: string; health: string };
    assert.equal(body.accountId, 'acct_intellifleet');
    assert.equal(body.health, 'healthy');
    assert.ok(res.headers.get('x-ratelimit-remaining'));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
