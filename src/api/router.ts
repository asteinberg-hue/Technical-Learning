/**
 * Routing and the request pipeline: liveness, authentication, rate limiting,
 * dispatch, and uniform error/JSON serialization.
 *
 * `handleRoute` is transport-agnostic and returns a plain, serializable
 * response, so it can be exercised directly in tests. `createServer` is the
 * thin node:http adapter on top of it.
 */

import { createServer as createHttpServer, type Server } from 'node:http';
import type { AuthContext } from './auth.ts';
import { Authenticator } from './auth.ts';
import { ApiError } from './errors.ts';
import { RateLimiter } from './rateLimiter.ts';
import type { HandlerContext, HandlerResult, RequestParams } from './handlers.ts';
import { getDock, getRobot, getRollup, listDocks, listRobots, listSites } from './handlers.ts';
import type { TelemetryStore } from '../store/telemetryStore.ts';

export interface RouterDeps {
  store: TelemetryStore;
  authenticator: Authenticator;
  rateLimiter: RateLimiter;
  now: () => Date;
}

export interface RouteResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (ctx: HandlerContext, auth: AuthContext, params: RequestParams) => HandlerResult;

interface Route {
  method: string;
  pattern: string[];
  handler: Handler;
}

const ROUTES: Route[] = [
  route('GET', '/v1/accounts/:accountId/sites', listSites),
  route('GET', '/v1/accounts/:accountId/telemetry/rollup', getRollup),
  route('GET', '/v1/accounts/:accountId/robots/:robotId', getRobot),
  route('GET', '/v1/accounts/:accountId/robots', listRobots),
  route('GET', '/v1/accounts/:accountId/docks/:dockId', getDock),
  route('GET', '/v1/accounts/:accountId/docks', listDocks),
];

export function handleRoute(
  deps: RouterDeps,
  method: string,
  urlString: string,
  headers: Record<string, string | undefined>,
): RouteResponse {
  const url = new URL(urlString, 'http://internal');
  const segments = splitPath(url.pathname);

  // Liveness check: no auth, no rate limiting.
  if (method === 'GET' && url.pathname === '/healthz') {
    return json(200, { status: 'ok', time: deps.now().toISOString() });
  }

  try {
    const auth = deps.authenticator.authenticate(headers['authorization']);

    // Rate limiting uses the wall clock, independent of the (possibly frozen)
    // service clock used for telemetry freshness.
    const limit = deps.rateLimiter.check(auth.accountId);
    const rateHeaders = rateLimitHeaders(limit);
    if (!limit.allowed) {
      const retryAfter = Math.max(0, Math.ceil((limit.resetAtMs - Date.now()) / 1000));
      throw new ApiError(429, 'rate_limited', `Rate limit exceeded. Retry after ${retryAfter}s.`);
    }

    const match = matchRoute(method, segments);
    if (match === null) {
      throw ApiError.notFound('No such route.');
    }

    const params: RequestParams = { ...match.params, query: url.searchParams };
    const ctx: HandlerContext = { store: deps.store, now: deps.now };
    const result = match.route.handler(ctx, auth, params);
    return { status: result.status, headers: { 'content-type': 'application/json', ...rateHeaders }, body: result.body };
  } catch (err) {
    return errorResponse(err);
  }
}

export function createServer(deps: RouterDeps): Server {
  return createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const response = handleRoute(deps, req.method ?? 'GET', req.url ?? '/', flattenHeaders(req.headers));
      const payload = JSON.stringify(response.body ?? {});
      res.writeHead(response.status, response.headers);
      res.end(payload);
    });
  });
}

function matchRoute(
  method: string,
  segments: string[],
): { route: Route; params: { accountId: string; robotId?: string; dockId?: string } } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    if (route.pattern.length !== segments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < route.pattern.length; i += 1) {
      const patternSeg = route.pattern[i]!;
      const actualSeg = segments[i]!;
      if (patternSeg.startsWith(':')) {
        params[patternSeg.slice(1)] = decodeURIComponent(actualSeg);
      } else if (patternSeg !== actualSeg) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return {
        route,
        params: { accountId: params['accountId'] ?? '', robotId: params['robotId'], dockId: params['dockId'] },
      };
    }
  }
  return null;
}

function route(method: string, pattern: string, handler: Handler): Route {
  return { method, pattern: splitPath(pattern), handler };
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

function rateLimitHeaders(limit: { limit: number; remaining: number; resetAtMs: number }): Record<string, string> {
  return {
    'x-ratelimit-limit': String(limit.limit),
    'x-ratelimit-remaining': String(limit.remaining),
    'x-ratelimit-reset': String(Math.floor(limit.resetAtMs / 1000)),
  };
}

function errorResponse(err: unknown): RouteResponse {
  if (err instanceof ApiError) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (err.status === 429) {
      headers['retry-after'] = '1';
    }
    return { status: err.status, headers, body: err.toBody() };
  }
  return {
    status: 500,
    headers: { 'content-type': 'application/json' },
    body: { error: { code: 'internal_error', message: 'An unexpected error occurred.' } },
  };
}

function json(status: number, body: unknown): RouteResponse {
  return { status, headers: { 'content-type': 'application/json' }, body };
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}
