/**
 * Tiny in-process TTL cache with request coalescing (no extra dependency).
 *
 * Why it exists: every dashboard refresh fires four aggregation pipelines
 * (overview, trends, breakdowns, forecast) over the same batch, and the same
 * filter combination is requested again whenever the user flips back to a
 * previous filter, resizes the window in dev (React strict mode double-fires
 * effects), or opens the app in a second tab. A completed upload batch never
 * changes, so identical requests can safely share one result for a short time.
 *
 * - `wrap(key, loader)` returns the cached value, or runs `loader()` once even
 *   if many identical requests arrive at the same moment.
 * - `invalidatePrefix(prefix)` drops every entry for a batch (used on delete)
 *   and makes any loader that was already running skip storing its result.
 * - A TTL of 0 disables caching entirely.
 */
export class TtlCache {
  #store = new Map(); // key -> { value, expiresAt }; Map order doubles as LRU order
  #inflight = new Map(); // key -> Promise
  #generation = 0;

  constructor({ ttlMs = 120_000, maxEntries = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get enabled() {
    return this.ttlMs > 0 && this.maxEntries > 0;
  }

  get size() {
    return this.#store.size;
  }

  async wrap(key, loader) {
    if (!this.enabled) return loader();

    const hit = this.#store.get(key);
    if (hit) {
      if (hit.expiresAt > Date.now()) {
        // Re-insert so the most recently used entry is the last to be evicted.
        this.#store.delete(key);
        this.#store.set(key, hit);
        return hit.value;
      }
      this.#store.delete(key);
    }

    const pending = this.#inflight.get(key);
    if (pending) return pending;

    const generation = this.#generation;
    const promise = (async () => {
      try {
        const value = await loader();
        // An invalidation that happened while we were loading means the value
        // may describe data that no longer exists, so do not store it.
        if (generation === this.#generation) this.#set(key, value);
        return value;
      } finally {
        this.#inflight.delete(key);
      }
    })();

    this.#inflight.set(key, promise);
    return promise;
  }

  #set(key, value) {
    this.#store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.#store.size > this.maxEntries) {
      const oldest = this.#store.keys().next().value;
      this.#store.delete(oldest);
    }
  }

  invalidatePrefix(prefix) {
    this.#generation += 1;
    for (const key of [...this.#store.keys()]) {
      if (key.startsWith(prefix)) this.#store.delete(key);
    }
  }

  /**
   * Drops every entry whose key satisfies `predicate` (used when a file is
   * deleted: any cached result that includes that file, whatever else it
   * combines it with, is now wrong).
   */
  invalidateWhere(predicate) {
    this.#generation += 1;
    for (const key of [...this.#store.keys()]) {
      if (predicate(key)) this.#store.delete(key);
    }
  }

  clear() {
    this.#generation += 1;
    this.#store.clear();
  }
}

/** Shared cache for analytics responses (see analytics.controller.js). */
export const analyticsCache = new TtlCache({
  ttlMs: (Number(process.env.CACHE_TTL_SECONDS ?? 120) || 0) * 1000,
  maxEntries: Number(process.env.CACHE_MAX_ENTRIES) || 500,
});
