/**
 * Deterministic mock fleet, seeded relative to a fixed "now" so the demo data
 * exercises every health state (healthy, stale, degraded, unavailable, unknown)
 * and mirrors the accounts named in the PRD.
 *
 * All timestamps are computed as offsets from a reference instant so the data
 * stays meaningful regardless of when the server starts. This is illustrative
 * scaffolding for discovery, not production data.
 */

import type {
  Account,
  DockTelemetrySample,
  RobotTelemetrySample,
} from '../domain/types.ts';

export interface SeedData {
  accounts: Account[];
  robots: RobotTelemetrySample[];
  docks: DockTelemetrySample[];
}

const MINUTE = 60 * 1000;

/** Build the seed dataset relative to `reference` (defaults to now). */
export function buildSeedData(reference: Date = new Date()): SeedData {
  const ago = (minutes: number): string => new Date(reference.getTime() - minutes * MINUTE).toISOString();

  const accounts: Account[] = [
    {
      accountId: 'acct_wareex',
      name: 'WareEx Logistics',
      sites: [
        { siteId: 'wareex_east', name: 'WareEx East DC', region: 'us-east' },
        { siteId: 'wareex_west', name: 'WareEx West DC', region: 'us-west' },
      ],
    },
    {
      accountId: 'acct_intellifleet',
      name: 'IntelliFleet Systems',
      sites: [{ siteId: 'if_hq', name: 'IntelliFleet HQ Facility', region: 'us-central' }],
    },
    {
      accountId: 'acct_northwind',
      name: 'Northwind Manufacturing',
      sites: [
        { siteId: 'nw_plant1', name: 'Northwind Plant 1', region: 'eu-west' },
        { siteId: 'nw_plant2', name: 'Northwind Plant 2', region: 'eu-west' },
      ],
    },
  ];

  const robots: RobotTelemetrySample[] = [
    // WareEx East — mostly healthy, one degraded (needs calibration).
    robot('wareex_east', 'wx-e-01', 'active', 'moving', 'calibrated', 82, ago(1)),
    robot('wareex_east', 'wx-e-02', 'idle', 'idle', 'calibrated', 64, ago(2)),
    robot('wareex_east', 'wx-e-03', 'active', 'holding', 'needs_calibration', 55, ago(1)),
    // WareEx West — one stale, one error (degraded).
    robot('wareex_west', 'wx-w-01', 'charging', 'idle', 'calibrated', 31, ago(9)),
    robot('wareex_west', 'wx-w-02', 'error', 'fault', 'calibrated', 12, ago(1)),
    // IntelliFleet — healthy fleet.
    robot('if_hq', 'if-01', 'active', 'moving', 'calibrated', 90, ago(1)),
    robot('if_hq', 'if-02', 'active', 'holding', 'calibrated', 77, ago(3)),
    // Northwind Plant 1 — one robot gone dark (unavailable).
    robot('nw_plant1', 'nw-1-01', 'offline', 'unknown', 'unknown', null, ago(40)),
    robot('nw_plant1', 'nw-1-02', 'idle', 'idle', 'calibrated', 58, ago(2)),
    // Northwind Plant 2 — healthy.
    robot('nw_plant2', 'nw-2-01', 'active', 'moving', 'calibrated', 71, ago(1)),
  ];

  const docks: DockTelemetrySample[] = [
    dock('wareex_east', 'wx-e-dock-a', ago(1), '2.4.1'),
    dock('wareex_east', 'wx-e-dock-b', ago(3), '2.4.1'),
    dock('wareex_west', 'wx-w-dock-a', ago(2), '2.4.0'),
    dock('if_hq', 'if-dock-a', ago(1), '2.5.0'),
    // Northwind Plant 1 — the silently-dead dock from the PRD's headline incident.
    dock('nw_plant1', 'nw-1-dock-a', ago(52), '2.3.7'),
    // Northwind Plant 2 — a dock that has never reported (unknown, not healthy).
    dock('nw_plant2', 'nw-2-dock-a', null, null),
  ];

  return { accounts, robots, docks };
}

function robot(
  siteId: string,
  robotId: string,
  operationalState: RobotTelemetrySample['operationalState'],
  armState: RobotTelemetrySample['armState'],
  calibrationState: RobotTelemetrySample['calibrationState'],
  batteryPct: number | null,
  lastSeenAt: string,
): RobotTelemetrySample {
  return { robotId, siteId, operationalState, armState, calibrationState, batteryPct, lastSeenAt };
}

function dock(
  siteId: string,
  dockId: string,
  lastHeartbeatAt: string | null,
  firmwareVersion: string | null,
): DockTelemetrySample {
  return { dockId, siteId, lastHeartbeatAt, firmwareVersion };
}
