/**
 * Aggregates per-device health into per-site and per-account rollups — the
 * cross-site visibility the PRD asks for.
 */

import type {
  Account,
  AccountRollup,
  DockHealth,
  HealthState,
  HealthStateCounts,
  RobotHealth,
  RobotStateCounts,
  Site,
  SiteRollup,
} from './types.ts';
import { worstHealth } from './health.ts';

function emptyHealthCounts(): HealthStateCounts {
  return { healthy: 0, stale: 0, degraded: 0, unavailable: 0, unknown: 0 };
}

function emptyRobotStateCounts(): RobotStateCounts {
  return { active: 0, idle: 0, charging: 0, error: 0, offline: 0 };
}

function maxTimestamp(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Build the rollup for a single site from its already-assessed devices. */
export function buildSiteRollup(
  site: Site,
  robots: readonly RobotHealth[],
  docks: readonly DockHealth[],
): SiteRollup {
  const robotStateCounts = emptyRobotStateCounts();
  const robotHealthCounts = emptyHealthCounts();
  const dockHealthCounts = emptyHealthCounts();
  const healthStates: HealthState[] = [];
  let lastUpdatedAt: string | null = null;

  for (const robot of robots) {
    robotStateCounts[robot.operationalState] += 1;
    robotHealthCounts[robot.health.state] += 1;
    healthStates.push(robot.health.state);
    lastUpdatedAt = maxTimestamp(lastUpdatedAt, robot.health.lastSeenAt);
  }

  for (const dock of docks) {
    dockHealthCounts[dock.health.state] += 1;
    healthStates.push(dock.health.state);
    lastUpdatedAt = maxTimestamp(lastUpdatedAt, dock.health.lastSeenAt);
  }

  return {
    siteId: site.siteId,
    name: site.name,
    region: site.region,
    robotCount: robots.length,
    robotStateCounts,
    robotHealthCounts,
    dockCount: docks.length,
    dockHealthCounts,
    health: worstHealth(healthStates),
    lastUpdatedAt,
  };
}

/**
 * Build a cross-site rollup for an account.
 *
 * `sites` is the (already authorization- and filter-scoped) list of sites to
 * include. Robots and docks are bucketed by `siteId`; anything whose site is
 * not in `sites` is ignored, which keeps unauthorized sites out of the result.
 */
export function buildAccountRollup(
  account: Account,
  sites: readonly Site[],
  robots: readonly RobotHealth[],
  docks: readonly DockHealth[],
  now: Date,
): AccountRollup {
  const robotsBySite = groupBy(robots, (r) => r.siteId);
  const docksBySite = groupBy(docks, (d) => d.siteId);

  const siteRollups = sites.map((site) =>
    buildSiteRollup(site, robotsBySite.get(site.siteId) ?? [], docksBySite.get(site.siteId) ?? []),
  );

  const robotHealthCounts = emptyHealthCounts();
  const dockHealthCounts = emptyHealthCounts();
  const healthStates: HealthState[] = [];
  let robotCount = 0;
  let dockCount = 0;

  for (const siteRollup of siteRollups) {
    robotCount += siteRollup.robotCount;
    dockCount += siteRollup.dockCount;
    addCounts(robotHealthCounts, siteRollup.robotHealthCounts);
    addCounts(dockHealthCounts, siteRollup.dockHealthCounts);
    healthStates.push(siteRollup.health);
  }

  return {
    accountId: account.accountId,
    name: account.name,
    generatedAt: now.toISOString(),
    siteCount: siteRollups.length,
    robotCount,
    dockCount,
    health: worstHealth(healthStates),
    robotHealthCounts,
    dockHealthCounts,
    sites: siteRollups,
  };
}

function addCounts(target: HealthStateCounts, source: HealthStateCounts): void {
  const states: HealthState[] = ['healthy', 'stale', 'degraded', 'unavailable', 'unknown'];
  for (const state of states) {
    target[state] += source[state];
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket === undefined) {
      map.set(k, [item]);
    } else {
      bucket.push(item);
    }
  }
  return map;
}
