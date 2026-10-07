/**
 * Operation-aware retries. There is deliberately NO generic retry-everything wrapper:
 * each exported function carries its own classification of what is safe to retry.
 */
import { statusOf } from "./errors";

export const MAX_ATTEMPTS = 3;

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

interface Policy {
  /** Return true if this error is a classified transient error for THIS operation. */
  isRetryable: (err: unknown) => boolean;
  maxAttempts?: number;
  baseMs?: number;
  sleep?: Sleep;
  /** Optional server-suggested delay (seconds). */
  retryAfterOf?: (err: unknown) => number | undefined;
}

async function run<T>(fn: (attempt: number) => Promise<T>, p: Policy): Promise<T> {
  const max = Math.min(p.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS);
  const base = p.baseMs ?? 400;
  const sleep = p.sleep ?? realSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= max || !p.isRetryable(err)) throw err;
      const hinted = p.retryAfterOf?.(err);
      const backoff = Math.min(8000, base * 2 ** (attempt - 1));
      const jitter = 0.75 + Math.random() * 0.5;
      await sleep(hinted !== undefined ? Math.min(hinted * 1000, 10_000) : Math.floor(backoff * jitter));
    }
  }
  throw lastErr;
}

const isNetwork = (err: unknown) => {
  const s = statusOf(err);
  return s === undefined || s === 0;
};

/** Reads (recall, health, status, count): idempotent, so transient failures are retried. */
export function retryRead<T>(fn: (attempt: number) => Promise<T>, opts: { sleep?: Sleep; baseMs?: number } = {}): Promise<T> {
  return run(fn, {
    ...opts,
    isRetryable: (err) => {
      const s = statusOf(err);
      return isNetwork(err) || s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
    },
  });
}

/**
 * Writes: refuses to run without a stable idempotency key (type + runtime check).
 * Retries only clearly-transient pre-acceptance failures; a 504/timeout is NOT retried automatically,
 * because the outcome is unconfirmed. The user retries explicitly with the SAME key.
 */
export function retryWrite<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { idempotencyKey: string; sleep?: Sleep; baseMs?: number },
): Promise<T> {
  if (!opts.idempotencyKey) throw new Error("retryWrite requires an idempotencyKey");
  return run(fn, {
    sleep: opts.sleep,
    baseMs: opts.baseMs,
    isRetryable: (err) => {
      const s = statusOf(err);
      const msg = String((err as { message?: unknown })?.message ?? "");
      if (/timed out|timeout/i.test(msg) || s === 504 || s === 408) return false;
      if (/job failed/i.test(msg)) return false;
      return s === 429 || s === 502 || s === 503 || (s === 0);
    },
  });
}

/** LLM request START only (before any token was produced). */
export function retryLlmStart<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { sleep?: Sleep; baseMs?: number } = {},
): Promise<T> {
  return run(fn, {
    ...opts,
    isRetryable: (err) => {
      const s = statusOf(err);
      if (s === 404 || s === 400 || s === 401 || s === 403) return false;
      return isNetwork(err) || s === 429 || (s !== undefined && s >= 500);
    },
    retryAfterOf: (err) => {
      const h = (err as { responseHeaders?: Record<string, string> })?.responseHeaders;
      const v = h?.["retry-after"] ? Number(h["retry-after"]) : undefined;
      return Number.isFinite(v) ? v : undefined;
    },
  });
}
