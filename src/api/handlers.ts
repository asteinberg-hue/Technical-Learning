/**
 * Request handlers. Each is a pure function of (context, auth, params) so it can
 * be unit-tested without spinning up an HTTP server. The router is responsible
 * only for parsing the request and serializing the result.
 */

import type { AuthContext } from './auth.ts';
import { resolveSiteScope } from './auth.ts';
import { ApiError } from './errors.ts';
import { paginate, parseLimit } from './pagination.ts';
import type { TelemetryStore } from '../store/telemetryStore.ts';
import { assessDockHealth, assessRobotHealth } from '../domain/health.ts';
import { buildAccountRollup } from '../domain/rollup.ts';

export interface HandlerContext {
  store: TelemetryStore;
  now: () => Date;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface RequestParams {
  accountId: string;
  robotId?: string;
  dockId?: string;
  query: URLSearchParams;
}

/** GET /v1/accounts/:accountId/sites */
export function listSites(ctx: HandlerContext, auth: AuthContext, params: RequestParams): HandlerResult {
  requireAccount(ctx, auth, params.accountId);
  const scope = resolveSiteScope(auth, params.accountId, readSiteFilter(params.query));
  const sites = ctx.store.listSites(params.accountId, scope);
  return { status: 200, body: { accountId: params.accountId, sites } };
}

/** GET /v1/accounts/:accountId/telemetry/rollup?siteId=... */
export function getRollup(ctx: HandlerContext, auth: AuthContext, params: RequestParams): HandlerResult {
  const account = requireAccount(ctx, auth, params.accountId);
  const scope = resolveSiteScope(auth, params.accountId, readSiteFilter(params.query));
  const now = ctx.now();

  const sites = ctx.store.listSites(params.accountId, scope);
  const robots = ctx.store
    .getRobotSamples(params.accountId, scope)
    .map((sample) => assessRobotHealth(sample, now));
  const docks = ctx.store
    .getDockSamples(params.accountId, scope)
    .map((sample) => assessDockHealth(sample, now));

  const rollup = buildAccountRollup(account, sites, robots, docks, now);
  return { status: 200, body: rollup };
}

/** GET /v1/accounts/:accountId/robots?siteId=&state=&cursor=&limit= */
export function listRobots(ctx: HandlerContext, auth: AuthContext, params: RequestParams): HandlerResult {
  requireAccount(ctx, auth, params.accountId);
  const scope = resolveSiteScope(auth, params.accountId, readSiteFilter(params.query));
  const now = ctx.now();

  const stateFilter = params.query.get('state');
  const limit = parseLimit(params.query.get('limit'));

  let robots = ctx.store
    .getRobotSamples(params.accountId, scope)
    .map((sample) => assessRobotHealth(sample, now));

  if (stateFilter !== null) {
    robots = robots.filter((r) => r.operationalState === stateFilter);
  }

  robots.sort((a, b) => a.robotId.localeCompare(b.robotId));
  const page = paginate(robots, params.query.get('cursor'), limit);
  return { status: 200, body: { robots: page.items, nextCursor: page.nextCursor } };
}

/** GET /v1/accounts/:accountId/robots/:robotId */
export function getRobot(ctx: HandlerContext, auth: AuthContext, params: RequestParams): HandlerResult {
  requireAccount(ctx, auth, params.accountId);
  const scope = resolveSiteScope(auth, params.accountId, undefined);
  const robotId = required(params.robotId, 'robotId');

  const sample = ctx.store.getRobotSample(params.accountId, robotId);
  if (sample === undefined || !inScope(scope, sample.siteId)) {
    throw ApiError.notFound(`Robot "${robotId}" was not found.`);
  }
  return { status: 200, body: assessRobotHealth(sample, ctx.now()) };
}

/** GET /v1/accounts/:accountId/docks?siteId=&cursor=&limit= */
export function listDocks(ctx: HandlerContext, auth: AuthContext, params: RequestParams): HandlerResult {
  requireAccount(ctx, auth, params.accountId);
  const scope = resolveSiteScope(auth, params.accountId, readSiteFilter(params.query));
  const now = ctx.now();
  const limit = parseLimit(params.query.get('limit'));

  const docks = ctx.store
    .getDockSamples(params.accountId, scope)
    .map((sample) => assessDockHealth(sample, now))
    .sort((a, b) => a.dockId.localeCompare(b.dockId));

  const page = paginate(docks, params.query.get('cursor'), limit);
  return { status: 200, body: { docks: page.items, nextCursor: page.nextCursor } };
}

/** GET /v1/accounts/:accountId/docks/:dockId */
export function getDock(ctx: HandlerContext, auth: AuthContext, params: RequestParams): HandlerResult {
  requireAccount(ctx, auth, params.accountId);
  const scope = resolveSiteScope(auth, params.accountId, undefined);
  const dockId = required(params.dockId, 'dockId');

  const sample = ctx.store.getDockSample(params.accountId, dockId);
  if (sample === undefined || !inScope(scope, sample.siteId)) {
    throw ApiError.notFound(`Dock "${dockId}" was not found.`);
  }
  return { status: 200, body: assessDockHealth(sample, ctx.now()) };
}

function requireAccount(ctx: HandlerContext, auth: AuthContext, accountId: string) {
  if (accountId !== auth.accountId) {
    // Do not reveal whether the account exists to an unauthorized caller.
    throw ApiError.forbidden('API key is not authorized for the requested account.');
  }
  const account = ctx.store.getAccount(accountId);
  if (account === undefined) {
    throw ApiError.notFound(`Account "${accountId}" was not found.`);
  }
  return account;
}

function readSiteFilter(query: URLSearchParams): string[] | undefined {
  const values = query.getAll('siteId').flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v.length > 0);
  return values.length > 0 ? values : undefined;
}

function inScope(scope: ReadonlySet<string> | undefined, siteId: string): boolean {
  return scope === undefined || scope.has(siteId);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw ApiError.badRequest(`Missing "${name}".`);
  }
  return value;
}
