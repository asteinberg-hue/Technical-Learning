import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessDockHealth, assessRobotHealth } from '../src/domain/health.ts';
import { buildAccountRollup } from '../src/domain/rollup.ts';
import { buildSeedData } from '../src/data/seed.ts';

const NOW = new Date('2026-08-05T20:30:00.000Z');
const seed = buildSeedData(NOW);

function rollupFor(accountId: string) {
  const account = seed.accounts.find((a) => a.accountId === accountId)!;
  const robots = seed.robots
    .filter((r) => account.sites.some((s) => s.siteId === r.siteId))
    .map((r) => assessRobotHealth(r, NOW));
  const docks = seed.docks
    .filter((d) => account.sites.some((s) => s.siteId === d.siteId))
    .map((d) => assessDockHealth(d, NOW));
  return buildAccountRollup(account, account.sites, robots, docks, NOW);
}

test('WareEx account rollup aggregates counts across both sites', () => {
  const rollup = rollupFor('acct_wareex');
  assert.equal(rollup.siteCount, 2);
  assert.equal(rollup.robotCount, 5);
  assert.equal(rollup.dockCount, 3);
  assert.deepEqual(rollup.robotHealthCounts, {
    healthy: 2,
    stale: 1,
    degraded: 2,
    unavailable: 0,
    unknown: 0,
  });
  assert.deepEqual(rollup.dockHealthCounts, {
    healthy: 3,
    stale: 0,
    degraded: 0,
    unavailable: 0,
    unknown: 0,
  });
  // A degraded robot pulls the whole account to degraded (worst-of).
  assert.equal(rollup.health, 'degraded');
});

test('Northwind rollup surfaces the dead dock and the unknown dock', () => {
  const rollup = rollupFor('acct_northwind');
  // Plant 1 has a robot and dock that have gone dark → unavailable dominates.
  assert.equal(rollup.health, 'unavailable');
  assert.equal(rollup.dockHealthCounts.unavailable, 1);
  assert.equal(rollup.dockHealthCounts.unknown, 1);
  assert.equal(rollup.robotHealthCounts.unavailable, 1);
});

test('site rollup records the most recent telemetry timestamp', () => {
  const rollup = rollupFor('acct_wareex');
  const east = rollup.sites.find((s) => s.siteId === 'wareex_east')!;
  // Most recent east sample is 1 minute before NOW.
  assert.equal(east.lastUpdatedAt, new Date(NOW.getTime() - 60_000).toISOString());
});

test('a site with no devices rolls up as unknown', () => {
  const account = { accountId: 'acct_empty', name: 'Empty', sites: [{ siteId: 'x', name: 'X', region: null }] };
  const rollup = buildAccountRollup(account, account.sites, [], [], NOW);
  assert.equal(rollup.health, 'unknown');
  assert.equal(rollup.sites[0]!.lastUpdatedAt, null);
});
