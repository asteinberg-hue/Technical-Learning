# Cross-Site Fleet Telemetry API

Version: `v1` · Format: JSON · Transport: HTTP

This is the reference API for cross-site fleet telemetry rollups and health
signals. It lets a multi-site operator read a single, consistent view of fleet
health and build their own alerting on supported endpoints — no UI scraping and
no second health-data pipeline.

> This is a discovery-stage reference implementation. Field names are intended
> to be stable, but thresholds, packaging, and exact coverage are still being
> validated (see the PRD).

## Authentication

Every endpoint except `GET /healthz` requires a bearer token:

```
Authorization: Bearer <api key>
```

A key is bound to exactly one account and to the set of sites it may read.
Requests for a different account return `403`, and a site-scoped key can never
see sites outside its allow-list (even by asking for them explicitly).

Demo keys:

| Key | Account | Sites |
| --- | --- | --- |
| `wareex-demo-key` | `acct_wareex` | all |
| `wareex-east-only-key` | `acct_wareex` | `wareex_east` only |
| `intellifleet-demo-key` | `acct_intellifleet` | all |
| `northwind-demo-key` | `acct_northwind` | all |

## Health-state semantics

Every robot, dock, site, and account reports one normalized `health` state:

| State | Meaning |
| --- | --- |
| `healthy` | Telemetry is fresh and no fault is reported. |
| `stale` | Telemetry is aging past the freshness threshold but the device is not yet presumed offline. |
| `degraded` | Telemetry is fresh, but the device reports a fault (robot error, arm fault, needs calibration). |
| `unavailable` | Telemetry is old enough that the device is presumed offline. A silently-dead dock heartbeat surfaces here. |
| `unknown` | No telemetry has ever been received. Deliberately distinct from `healthy` so "missing" never reads as "fine". |

Rollups combine many states into one using a worst-of rule, ranked:
`unavailable` > `unknown` > `degraded` > `stale` > `healthy`.

Default freshness thresholds (configurable; placeholders pending discovery):
`stale` after 5 minutes, `unavailable` after 15 minutes.

Each device also returns a `health.reason` string and `health.ageMs` so support
and HQ engineers can understand *why* a device is in a given state.

## Endpoints

### `GET /healthz`
Liveness check. No auth. Returns `{ "status": "ok", "time": "<ISO>" }`.

### `GET /v1/accounts/{accountId}/telemetry/rollup`
Cross-site rollup for the account — the executive-reporting view.

Query params:
- `siteId` (optional, repeatable or comma-separated): restrict to specific sites.

Returns an `AccountRollup`: per-account and per-site device counts, health-state
counts, worst-of `health`, and `lastUpdatedAt`.

### `GET /v1/accounts/{accountId}/sites`
List the sites the credential may see. Supports `siteId` filtering.

### `GET /v1/accounts/{accountId}/robots`
List enriched robot telemetry. Query params:
- `siteId` (optional): filter by site.
- `state` (optional): filter by operational state (`active`, `idle`, `charging`, `error`, `offline`).
- `limit` (optional, default 50, max 200) and `cursor` (opaque) for pagination.

Returns `{ "robots": RobotHealth[], "nextCursor": string | null }`.

### `GET /v1/accounts/{accountId}/robots/{robotId}`
A single robot's enriched telemetry and health. `404` if the robot does not
exist or is outside the credential's site scope.

### `GET /v1/accounts/{accountId}/docks`
List enriched dock telemetry (heartbeat health). Supports `siteId`, `limit`,
`cursor`.

### `GET /v1/accounts/{accountId}/docks/{dockId}`
A single dock's heartbeat health. `404` if not found or out of scope.

## Rate limiting

Requests are limited per account (demo default: 120 requests/minute). Every
response carries:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (epoch seconds)

Over-limit requests return `429` with a `Retry-After` header.

## Errors

All errors share one shape:

```json
{ "error": { "code": "forbidden", "message": "..." } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | Invalid query parameter (e.g. bad `limit` or `cursor`). |
| 401 | `unauthorized` | Missing/malformed header or unknown key. |
| 403 | `forbidden` | Key not authorized for the requested account or site. |
| 404 | `not_found` | Unknown route or resource (also used to avoid leaking out-of-scope resources). |
| 429 | `rate_limited` | Rate limit exceeded. |
| 500 | `internal_error` | Unexpected server error. |

## Example

```bash
curl -s -H "Authorization: Bearer wareex-demo-key" \
  http://localhost:8080/v1/accounts/acct_wareex/telemetry/rollup
```
