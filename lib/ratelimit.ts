/** In-memory sliding-window limiter. Single-instance only (documented). Bounded size. */
export class RateLimiter {
  #hits = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = 5000) {}

  /** Returns 0 if allowed, else seconds until the window frees up. */
  check(key: string, limit: number, windowMs: number): number {
    const t = this.now();
    const arr = (this.#hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) {
      this.#hits.set(key, arr);
      return Math.max(1, Math.ceil((windowMs - (t - arr[0])) / 1000));
    }
    arr.push(t);
    this.#hits.delete(key);
    this.#hits.set(key, arr);
    if (this.#hits.size > this.maxKeys) this.#hits.delete(this.#hits.keys().next().value as string);
    return 0;
  }
}

export const LIMITS = {
  chat: { limit: 20, windowMs: 60_000 },
  extraction: { limit: 12, windowMs: 60_000 },
  writes: { limit: 40, windowMs: 3_600_000 },
  commands: { limit: 15, windowMs: 60_000 },
  read: { limit: 60, windowMs: 60_000 },
} as const;
