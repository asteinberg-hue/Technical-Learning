/**
 * A small fixed-window rate limiter, keyed by API key. Customer-safe rate
 * limits are called out in the PRD; this keeps a noisy integration from
 * overwhelming the service and gives clients the standard headers they need to
 * back off.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds at which the current window resets. */
  resetAtMs: number;
}

interface Window {
  count: number;
  startMs: number;
}

export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #windows = new Map<string, Window>();

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  check(key: string, now: Date = new Date()): RateLimitResult {
    const nowMs = now.getTime();
    const existing = this.#windows.get(key);

    if (existing === undefined || nowMs - existing.startMs >= this.#windowMs) {
      const fresh: Window = { count: 1, startMs: nowMs };
      this.#windows.set(key, fresh);
      return {
        allowed: true,
        limit: this.#limit,
        remaining: this.#limit - 1,
        resetAtMs: nowMs + this.#windowMs,
      };
    }

    const resetAtMs = existing.startMs + this.#windowMs;
    if (existing.count >= this.#limit) {
      return { allowed: false, limit: this.#limit, remaining: 0, resetAtMs };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit: this.#limit,
      remaining: this.#limit - existing.count,
      resetAtMs,
    };
  }
}
