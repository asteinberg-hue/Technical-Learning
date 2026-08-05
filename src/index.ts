/**
 * Server entrypoint. Wires the seed data, store, authenticator, and rate
 * limiter together and starts listening.
 *
 * The service clock is frozen to the moment the process starts, so the seeded
 * fleet demonstrates a stable mix of health states (healthy, stale, degraded,
 * unavailable, unknown) rather than drifting as wall-clock time passes.
 */

import { Authenticator } from './api/auth.ts';
import { RateLimiter } from './api/rateLimiter.ts';
import { createServer } from './api/router.ts';
import { TelemetryStore } from './store/telemetryStore.ts';
import { buildSeedData } from './data/seed.ts';
import { DEFAULT_PORT, DEMO_CREDENTIALS, RATE_LIMIT } from './config.ts';

const reference = new Date();
const store = new TelemetryStore(buildSeedData(reference));
const authenticator = new Authenticator(DEMO_CREDENTIALS);
const rateLimiter = new RateLimiter(RATE_LIMIT.limit, RATE_LIMIT.windowMs);

const server = createServer({
  store,
  authenticator,
  rateLimiter,
  now: () => reference,
});

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
server.listen(port, () => {
  console.log(`cross-site-telemetry API listening on http://localhost:${port}`);
  console.log('Try:');
  console.log(
    `  curl -s -H "Authorization: Bearer wareex-demo-key" ` +
      `http://localhost:${port}/v1/accounts/acct_wareex/telemetry/rollup`,
  );
});
