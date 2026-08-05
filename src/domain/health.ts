/**
 * Turns raw telemetry samples into normalized health assessments.
 *
 * All "how fresh is fresh enough" and "how do faults map to states" policy
 * lives here, so freshness thresholds and severity ordering can be reviewed and
 * tuned in one place (the PRD flags these as first-class, discovery-stage
 * decisions).
 */

import type {
  DockTelemetrySample,
  FreshnessThresholds,
  HealthAssessment,
  HealthState,
  RobotHealth,
  RobotTelemetrySample,
  DockHealth,
} from './types.ts';

/**
 * Default freshness thresholds. These are placeholders for discovery: the PRD
 * calls for validating real thresholds with customers before external SLAs.
 */
export const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  staleAfterMs: 5 * 60 * 1000, // 5 minutes
  unavailableAfterMs: 15 * 60 * 1000, // 15 minutes
};

/**
 * Severity ordering used when rolling many signals up into one. Higher wins.
 *
 * The ranking encodes a product judgment worth revisiting in discovery:
 * `unavailable` (device presumed offline) is the most urgent, `unknown` (we are
 * blind because nothing was ever reported) is next, then a known `degraded`
 * fault, then merely `stale` data, and finally `healthy`.
 */
const SEVERITY: Record<HealthState, number> = {
  healthy: 0,
  stale: 1,
  degraded: 2,
  unknown: 3,
  unavailable: 4,
};

/**
 * Assess health purely from data freshness. This is the foundation for both
 * robots and docks: if we have not heard from a device recently enough, nothing
 * else it last reported can be trusted.
 */
export function assessFreshness(
  lastSeenAt: string | null,
  now: Date,
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): HealthAssessment {
  if (lastSeenAt === null) {
    return {
      state: 'unknown',
      reason: 'No telemetry has ever been received for this device.',
      lastSeenAt: null,
      ageMs: null,
    };
  }

  const lastSeenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(lastSeenMs)) {
    return {
      state: 'unknown',
      reason: `Last-seen timestamp "${lastSeenAt}" could not be parsed.`,
      lastSeenAt,
      ageMs: null,
    };
  }

  const ageMs = now.getTime() - lastSeenMs;

  if (ageMs >= thresholds.unavailableAfterMs) {
    return {
      state: 'unavailable',
      reason: `No telemetry for ${formatDuration(ageMs)} (>= ${formatDuration(
        thresholds.unavailableAfterMs,
      )}); device is presumed offline.`,
      lastSeenAt,
      ageMs,
    };
  }

  if (ageMs >= thresholds.staleAfterMs) {
    return {
      state: 'stale',
      reason: `Telemetry is ${formatDuration(ageMs)} old (>= ${formatDuration(
        thresholds.staleAfterMs,
      )}); data may be out of date.`,
      lastSeenAt,
      ageMs,
    };
  }

  return {
    state: 'healthy',
    reason: `Telemetry is fresh (${formatDuration(ageMs)} old).`,
    lastSeenAt,
    ageMs,
  };
}

/**
 * Assess a robot. Freshness dominates: if data is stale/unavailable/unknown we
 * report that, because a "fresh-looking" fault flag from an offline robot is
 * misleading. When data is fresh, a reported fault downgrades health to
 * `degraded`.
 */
export function assessRobotHealth(
  sample: RobotTelemetrySample,
  now: Date,
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): RobotHealth {
  const freshness = assessFreshness(sample.lastSeenAt, now, thresholds);

  let health = freshness;
  if (freshness.state === 'healthy') {
    const fault = describeRobotFault(sample);
    if (fault !== null) {
      health = { ...freshness, state: 'degraded', reason: fault };
    }
  }

  return {
    robotId: sample.robotId,
    siteId: sample.siteId,
    operationalState: sample.operationalState,
    armState: sample.armState,
    calibrationState: sample.calibrationState,
    batteryPct: sample.batteryPct,
    health,
  };
}

/**
 * Assess a dock. A dock's health is its heartbeat freshness — this is the
 * signal that must surface reliably so operators learn about a dead dock
 * *before* a robot misses a shift.
 */
export function assessDockHealth(
  sample: DockTelemetrySample,
  now: Date,
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): DockHealth {
  const freshness = assessFreshness(sample.lastHeartbeatAt, now, thresholds);
  return {
    dockId: sample.dockId,
    siteId: sample.siteId,
    lastHeartbeatAt: sample.lastHeartbeatAt,
    firmwareVersion: sample.firmwareVersion,
    health: freshness,
  };
}

/** Combine many health states into a single worst-of value. */
export function worstHealth(states: readonly HealthState[]): HealthState {
  if (states.length === 0) {
    return 'unknown';
  }
  let worst: HealthState = 'healthy';
  for (const state of states) {
    if (SEVERITY[state] > SEVERITY[worst]) {
      worst = state;
    }
  }
  return worst;
}

function describeRobotFault(sample: RobotTelemetrySample): string | null {
  if (sample.operationalState === 'error') {
    return 'Robot reports an error operational state.';
  }
  if (sample.armState === 'fault') {
    return 'Robot arm reports a fault.';
  }
  if (sample.calibrationState === 'needs_calibration') {
    return 'Robot needs calibration.';
  }
  return null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
}
