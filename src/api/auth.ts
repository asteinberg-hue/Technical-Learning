/**
 * Bearer-token authentication and per-credential site authorization.
 *
 * A credential is bound to exactly one account and to the set of sites it may
 * read. This is deliberately simple, but it models the PRD's hard requirement:
 * cross-site visibility must never expose sites a customer is not entitled to.
 */

import { ApiError } from './errors.ts';

/** `'all'` means every site the account owns; otherwise an explicit allow-list. */
export interface ApiCredential {
  apiKey: string;
  accountId: string;
  authorizedSiteIds: 'all' | string[];
}

export interface AuthContext {
  accountId: string;
  /** `undefined` means "all sites for the account"; otherwise the allow-list. */
  authorizedSiteIds: ReadonlySet<string> | undefined;
}

export class Authenticator {
  readonly #byKey = new Map<string, ApiCredential>();

  constructor(credentials: readonly ApiCredential[]) {
    for (const credential of credentials) {
      this.#byKey.set(credential.apiKey, credential);
    }
  }

  /**
   * Resolve an `Authorization: Bearer <key>` header into an AuthContext, or
   * throw a 401. Does not check which account is being requested — that
   * comparison happens in the handler once the account is known.
   */
  authenticate(authorizationHeader: string | undefined): AuthContext {
    const key = parseBearer(authorizationHeader);
    if (key === null) {
      throw ApiError.unauthorized('Missing or malformed Authorization header. Use "Bearer <api key>".');
    }
    const credential = this.#byKey.get(key);
    if (credential === undefined) {
      throw ApiError.unauthorized('Unknown API key.');
    }
    return {
      accountId: credential.accountId,
      authorizedSiteIds:
        credential.authorizedSiteIds === 'all'
          ? undefined
          : new Set(credential.authorizedSiteIds),
    };
  }
}

/**
 * Enforce that the requested account matches the credential's account, and
 * return the effective set of site IDs to read: the intersection of the
 * credential's authorized sites with an optional `siteId` request filter.
 *
 * Returns `undefined` only when the credential is account-wide AND no filter was
 * supplied, which the store interprets as "all of the account's sites".
 */
export function resolveSiteScope(
  auth: AuthContext,
  requestedAccountId: string,
  requestedSiteIds: string[] | undefined,
): ReadonlySet<string> | undefined {
  if (requestedAccountId !== auth.accountId) {
    throw ApiError.forbidden('API key is not authorized for the requested account.');
  }

  const filter = requestedSiteIds === undefined ? undefined : new Set(requestedSiteIds);

  if (auth.authorizedSiteIds === undefined) {
    return filter; // account-wide credential; honor the request filter as-is.
  }

  if (filter === undefined) {
    return auth.authorizedSiteIds; // restricted credential, no filter.
  }

  // Both present: intersect, and reject if the caller asked for a forbidden site.
  const forbidden = [...filter].filter((id) => !auth.authorizedSiteIds!.has(id));
  if (forbidden.length > 0) {
    throw ApiError.forbidden(`API key is not authorized for site(s): ${forbidden.join(', ')}.`);
  }
  return filter;
}

function parseBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1]?.trim() ?? '';
  return token.length > 0 ? token : null;
}
