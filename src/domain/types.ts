/**
 * Core domain types for cross-site fleet telemetry.
 *
 * These names are the public contract of the API. Keep them stable: customers
 * build alerting and automation directly against these fields (see the PRD's
 * "Supported API access" requirement).
 */

/**
 * Normalized health of a single signal or an aggregate of signals.
 *
 * The set is deliberately small and consistent across robots, docks, sites, and
 * accounts so a customer can reason about "green vs not green" uniformly.
 *
 * - `healthy`      Telemetry is fresh and no fault is reported.
 * - `stale`        Telemetry is aging past the freshness threshold but the
 *                  device is not yet presumed offline.
 * - `degraded`     Telemetry is fresh, but the device reports a fault
 *                  (e.g. robot error, arm fault, needs calibration).
 * - `unavailable`  Telemetry is old enough that the device is presumed offline
 *                  (this is how a silently-dead dock heartbeat surfaces).
 * - `unknown`      No telemetry has ever been received. This is intentionally
 *                  distinct from `healthy` so "missing" never reads as "fine".
 */
export type HealthState = 'healthy' | 'stale' | 'degraded' | 'unavailable' | 'unknown';

export type RobotOperationalState = 'active' | 'idle' | 'charging' | 'error' | 'offline';

export type ArmState = 'moving' | 'holding' | 'idle' | 'fault' | 'unknown';

export type CalibrationState = 'calibrated' | 'calibrating' | 'needs_calibration' | 'unknown';

/** A physical facility. A single account may operate many of these. */
export interface Site {
  siteId: string;
  name: string;
  region: string | null;
}

/** An enterprise customer that operates one or more sites. */
export interface Account {
  accountId: string;
  name: string;
  sites: Site[];
}

/**
 * A raw telemetry sample as reported by a robot. This is the ingest shape; the
 * API never returns it directly — it is always enriched with a HealthAssessment.
 */
export interface RobotTelemetrySample {
  robotId: string;
  siteId: string;
  operationalState: RobotOperationalState;
  armState: ArmState;
  calibrationState: CalibrationState;
  batteryPct: number | null;
  /** ISO-8601 timestamp of the last sample received from this robot. */
  lastSeenAt: string;
}

/**
 * A raw telemetry sample for a dock. Docks are the reliability hot spot in the
 * PRD: when a dock silently stops heartbeating, robots miss shift starts.
 */
export interface DockTelemetrySample {
  dockId: string;
  siteId: string;
  /** ISO-8601 timestamp of the last heartbeat, or null if one was never seen. */
  lastHeartbeatAt: string | null;
  firmwareVersion: string | null;
}

/** How long telemetry may age before it is considered stale, then unavailable. */
export interface FreshnessThresholds {
  staleAfterMs: number;
  unavailableAfterMs: number;
}

/**
 * The computed health of a single device, with enough context for a support or
 * HQ engineer to understand *why* a device is in a given state without opening
 * a second tool.
 */
export interface HealthAssessment {
  state: HealthState;
  /** Human-readable explanation of the state, safe to surface to operators. */
  reason: string;
  lastSeenAt: string | null;
  /** Milliseconds between `lastSeenAt` and the assessment time; null if never seen. */
  ageMs: number | null;
}

export interface RobotHealth {
  robotId: string;
  siteId: string;
  operationalState: RobotOperationalState;
  armState: ArmState;
  calibrationState: CalibrationState;
  batteryPct: number | null;
  health: HealthAssessment;
}

export interface DockHealth {
  dockId: string;
  siteId: string;
  lastHeartbeatAt: string | null;
  firmwareVersion: string | null;
  health: HealthAssessment;
}

/** Per-health-state counts. Every state is always present (zero-filled). */
export type HealthStateCounts = Record<HealthState, number>;

export type RobotStateCounts = Record<RobotOperationalState, number>;

/** Rollup of a single site's fleet health. */
export interface SiteRollup {
  siteId: string;
  name: string;
  region: string | null;
  robotCount: number;
  robotStateCounts: RobotStateCounts;
  robotHealthCounts: HealthStateCounts;
  dockCount: number;
  dockHealthCounts: HealthStateCounts;
  /** Worst-of health across every robot and dock at the site. */
  health: HealthState;
  /** Most recent telemetry timestamp seen anywhere at the site; null if none. */
  lastUpdatedAt: string | null;
}

/** Cross-site rollup for an entire account — the executive-reporting view. */
export interface AccountRollup {
  accountId: string;
  name: string;
  /** When this rollup was computed (ISO-8601). */
  generatedAt: string;
  siteCount: number;
  robotCount: number;
  dockCount: number;
  health: HealthState;
  robotHealthCounts: HealthStateCounts;
  dockHealthCounts: HealthStateCounts;
  sites: SiteRollup[];
}
