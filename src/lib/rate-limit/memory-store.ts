import "server-only";
import type { HitResult, RateLimitStore } from "@/lib/rate-limit/store";

type Options = {
  /** Hard cap on stored counters (Cipher R3). */
  maxEntries?: number;
  /** Expired counters are swept at most this often. */
  pruneEveryMs?: number;
};

/**
 * In-process fixed-window counters, with the same window rule as the
 * database (windows start at multiples of windowSec since the epoch).
 * Only for tests, dev and the single-process local backend: several
 * instances each keep their own counts.
 *
 * Memory is bounded (Cipher R3): expired counters are swept at most once a
 * minute, and once `maxEntries` live counters exist a NEW key throws, so
 * limit() fails closed ("try again shortly"). We never evict a live counter:
 * that would let someone reset another client's count by flooding the map.
 */
export class MemoryStore implements RateLimitStore {
  private counts = new Map<string, { windowStart: number; count: number }>();
  private lastPruneMs: number;
  private readonly maxEntries: number;
  private readonly pruneEveryMs: number;

  constructor(
    private now: () => number = Date.now,
    { maxEntries = 100_000, pruneEveryMs = 60_000 }: Options = {},
  ) {
    this.maxEntries = maxEntries;
    this.pruneEveryMs = pruneEveryMs;
    this.lastPruneMs = now();
  }

  async hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
    const nowMs = this.now();
    const nowSec = nowMs / 1000;
    const windowStart = Math.floor(nowSec / windowSec) * windowSec;
    const mapKey = `${windowSec}:${key}`;

    if (nowMs - this.lastPruneMs >= this.pruneEveryMs) this.dropExpired(nowMs);

    const entry = this.counts.get(mapKey);
    if (!entry && this.counts.size >= this.maxEntries) {
      throw new Error("rate-limit memory store is full");
    }
    const count = entry && entry.windowStart === windowStart ? entry.count + 1 : 1;
    this.counts.set(mapKey, { windowStart, count });

    if (count <= limit) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(windowStart + windowSec - nowSec)) };
  }

  /** How many counters are stored (for tests). */
  get size(): number {
    return this.counts.size;
  }

  private dropExpired(nowMs: number) {
    this.lastPruneMs = nowMs;
    const nowSec = nowMs / 1000;
    for (const [mapKey, entry] of this.counts) {
      const windowSec = Number(mapKey.slice(0, mapKey.indexOf(":")));
      if (entry.windowStart + windowSec <= nowSec) this.counts.delete(mapKey);
    }
  }
}
