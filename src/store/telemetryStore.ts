/**
 * In-memory telemetry store. This is the data-access seam: swap this for a real
 * datastore later without touching the API or domain layers.
 *
 * The store never makes authorization decisions itself, but every read accepts
 * an optional `siteIds` allow-list so callers can scope results to the sites a
 * credential is permitted to see (and to any `siteId` query filter).
 */

import type {
  Account,
  DockTelemetrySample,
  RobotTelemetrySample,
} from '../domain/types.ts';
import type { SeedData } from '../data/seed.ts';

export class TelemetryStore {
  readonly #accounts = new Map<string, Account>();
  readonly #robots: RobotTelemetrySample[];
  readonly #docks: DockTelemetrySample[];

  constructor(data: SeedData) {
    for (const account of data.accounts) {
      this.#accounts.set(account.accountId, account);
    }
    this.#robots = [...data.robots];
    this.#docks = [...data.docks];
  }

  getAccount(accountId: string): Account | undefined {
    return this.#accounts.get(accountId);
  }

  /** Sites belonging to an account, optionally narrowed to `siteIds`. */
  listSites(accountId: string, siteIds?: ReadonlySet<string>): Account['sites'] {
    const account = this.#accounts.get(accountId);
    if (account === undefined) return [];
    if (siteIds === undefined) return account.sites;
    return account.sites.filter((site) => siteIds.has(site.siteId));
  }

  getRobotSamples(accountId: string, siteIds?: ReadonlySet<string>): RobotTelemetrySample[] {
    const allowed = this.#accountSiteIds(accountId, siteIds);
    return this.#robots.filter((r) => allowed.has(r.siteId));
  }

  getRobotSample(accountId: string, robotId: string): RobotTelemetrySample | undefined {
    const allowed = this.#accountSiteIds(accountId);
    return this.#robots.find((r) => r.robotId === robotId && allowed.has(r.siteId));
  }

  getDockSamples(accountId: string, siteIds?: ReadonlySet<string>): DockTelemetrySample[] {
    const allowed = this.#accountSiteIds(accountId, siteIds);
    return this.#docks.filter((d) => allowed.has(d.siteId));
  }

  getDockSample(accountId: string, dockId: string): DockTelemetrySample | undefined {
    const allowed = this.#accountSiteIds(accountId);
    return this.#docks.find((d) => d.dockId === dockId && allowed.has(d.siteId));
  }

  /**
   * Resolve the set of site IDs to read from: the account's own sites,
   * intersected with an optional caller-supplied filter. Returns an empty set
   * for unknown accounts so reads can never leak across accounts.
   */
  #accountSiteIds(accountId: string, filter?: ReadonlySet<string>): Set<string> {
    const account = this.#accounts.get(accountId);
    if (account === undefined) return new Set();
    const ids = account.sites
      .map((s) => s.siteId)
      .filter((id) => filter === undefined || filter.has(id));
    return new Set(ids);
  }
}
