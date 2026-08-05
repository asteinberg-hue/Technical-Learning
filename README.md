# Technical-Learning

Reference implementations for in-progress work. See open pull requests.

## Cross-site fleet telemetry (API-only)

A TypeScript, API-only reference implementation of the
[Cross-site fleet telemetry rollups and health-signal APIs](docs/API.md) PRD:
unified cross-site telemetry rollups plus a supported, documented API for
critical robot and dock health signals.

It demonstrates the MVP shape from the PRD:

- **Health-signal model** — robot/arm state, calibration state, and dock
  heartbeat, normalized into consistent health states (`healthy`, `stale`,
  `degraded`, `unavailable`, `unknown`) with freshness semantics that keep
  "missing" distinct from "healthy".
- **Cross-site rollups** — per-account and per-site aggregates for executive and
  operational reporting, with worst-of health and last-updated timestamps.
- **Supported API access** — stable JSON endpoints with bearer auth, per-site
  authorization, pagination/filtering, and rate limits, so customers can build
  alerting without scraping the UI or standing up a second pipeline.

### Requirements

Node.js >= 22.18 (the project runs TypeScript directly via Node's type
stripping; no build step is required).

### Install

```bash
npm install
```

### Run

```bash
npm start          # listens on http://localhost:8080 (override with PORT)
```

```bash
curl -s -H "Authorization: Bearer wareex-demo-key" \
  http://localhost:8080/v1/accounts/acct_wareex/telemetry/rollup
```

### Develop

```bash
npm run typecheck  # tsc --noEmit
npm test           # node's built-in test runner
```

### Layout

```
src/
  domain/      # types, health assessment, rollup aggregation (pure logic)
  data/        # deterministic mock fleet (WareEx, IntelliFleet, Northwind)
  store/       # in-memory telemetry store (data-access seam)
  api/         # auth, rate limiting, pagination, handlers, router/server
  config.ts    # demo credentials and limits
  index.ts     # entrypoint
tests/         # unit + integration tests
docs/API.md    # API reference, field definitions, health-state semantics
```

See [docs/API.md](docs/API.md) for the full endpoint and field reference.
