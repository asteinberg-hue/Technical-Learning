/**
 * Opaque cursor pagination. The cursor encodes a simple offset; it is opaque to
 * clients so the internal scheme can change without breaking them.
 */

import { ApiError } from './errors.ts';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw ApiError.badRequest('"limit" must be a positive integer.');
  }
  return Math.min(value, MAX_LIMIT);
}

function decodeCursor(raw: string | null): number {
  if (raw === null) return 0;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const match = /^offset:(\d+)$/.exec(decoded);
  if (match === null) {
    throw ApiError.badRequest('Invalid "cursor".');
  }
  return Number(match[1]);
}

function encodeCursor(offset: number): string {
  return Buffer.from(`offset:${offset}`, 'utf8').toString('base64url');
}

/** Slice `items` for one page given an opaque cursor and a limit. */
export function paginate<T>(items: readonly T[], cursor: string | null, limit: number): Page<T> {
  const offset = decodeCursor(cursor);
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const nextCursor = nextOffset < items.length ? encodeCursor(nextOffset) : null;
  return { items: slice, nextCursor };
}
