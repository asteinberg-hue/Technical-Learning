/**
 * Demo configuration. In a real deployment these credentials and limits would
 * come from a secret store and config service, not source code.
 */

import type { ApiCredential } from './api/auth.ts';

/** Demo API keys. Each is scoped to one account; one is restricted to a subset of sites. */
export const DEMO_CREDENTIALS: ApiCredential[] = [
  { apiKey: 'wareex-demo-key', accountId: 'acct_wareex', authorizedSiteIds: 'all' },
  // A restricted key: can only read WareEx's East DC. Demonstrates per-site authz.
  { apiKey: 'wareex-east-only-key', accountId: 'acct_wareex', authorizedSiteIds: ['wareex_east'] },
  { apiKey: 'intellifleet-demo-key', accountId: 'acct_intellifleet', authorizedSiteIds: 'all' },
  { apiKey: 'northwind-demo-key', accountId: 'acct_northwind', authorizedSiteIds: 'all' },
];

export const RATE_LIMIT = {
  limit: 120,
  windowMs: 60 * 1000,
} as const;

export const DEFAULT_PORT = 8080;
