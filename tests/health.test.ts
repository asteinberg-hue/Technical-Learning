import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessDockHealth,
  assessFreshness,
  assessRobotHealth,
  DEFAULT_THRESHOLDS,
  worstHealth,
} from '../src/domain/health.ts';
import type { DockTelemetrySample, RobotTelemetrySample } from '../src/domain/types.ts';

const NOW = new Date('2026-08-05T20:30:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

test('assessFreshness classifies by age against thresholds', () => {
  assert.equal(assessFreshness(minutesAgo(1), NOW).state, 'healthy');
  assert.equal(assessFreshness(minutesAgo(9), NOW).state, 'stale');
  assert.equal(assessFreshness(minutesAgo(40), NOW).state, 'unavailable');
});

test('assessFreshness treats missing telemetry as unknown, not healthy', () => {
  const assessment = assessFreshness(null, NOW);
  assert.equal(assessment.state, 'unknown');
  assert.equal(assessment.ageMs, null);
  assert.equal(assessment.lastSeenAt, null);
});

test('assessFreshness reports unknown for an unparseable timestamp', () => {
  assert.equal(assessFreshness('not-a-date', NOW).state, 'unknown');
});

test('boundary at staleAfterMs is inclusive (stale)', () => {
  const at = new Date(NOW.getTime() - DEFAULT_THRESHOLDS.staleAfterMs).toISOString();
  assert.equal(assessFreshness(at, NOW).state, 'stale');
});

test('assessRobotHealth: fresh robot with a fault is degraded', () => {
  const sample: RobotTelemetrySample = {
    robotId: 'r1',
    siteId: 's1',
    operationalState: 'error',
    armState: 'idle',
    calibrationState: 'calibrated',
    batteryPct: 50,
    lastSeenAt: minutesAgo(1),
  };
  assert.equal(assessRobotHealth(sample, NOW).health.state, 'degraded');
});

test('assessRobotHealth: staleness dominates a fault flag', () => {
  const sample: RobotTelemetrySample = {
    robotId: 'r2',
    siteId: 's1',
    operationalState: 'error',
    armState: 'fault',
    calibrationState: 'needs_calibration',
    batteryPct: 50,
    lastSeenAt: minutesAgo(20),
  };
  // We stopped hearing from it, so we report unavailable rather than a
  // possibly-outdated fault state.
  assert.equal(assessRobotHealth(sample, NOW).health.state, 'unavailable');
});

test('assessRobotHealth: healthy robot stays healthy', () => {
  const sample: RobotTelemetrySample = {
    robotId: 'r3',
    siteId: 's1',
    operationalState: 'active',
    armState: 'moving',
    calibrationState: 'calibrated',
    batteryPct: 88,
    lastSeenAt: minutesAgo(1),
  };
  assert.equal(assessRobotHealth(sample, NOW).health.state, 'healthy');
});

test('assessDockHealth: a long-silent dock is unavailable', () => {
  const sample: DockTelemetrySample = {
    dockId: 'd1',
    siteId: 's1',
    lastHeartbeatAt: minutesAgo(52),
    firmwareVersion: '2.3.7',
  };
  assert.equal(assessDockHealth(sample, NOW).health.state, 'unavailable');
});

test('worstHealth ranks unavailable above all and empty as unknown', () => {
  assert.equal(worstHealth(['healthy', 'stale', 'unavailable', 'degraded']), 'unavailable');
  assert.equal(worstHealth(['healthy', 'stale']), 'stale');
  assert.equal(worstHealth(['healthy', 'unknown', 'degraded']), 'unknown');
  assert.equal(worstHealth([]), 'unknown');
});
