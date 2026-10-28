import type { HitResult, RateLimitStore } from "@/lib/rate-limit/store";

/**
 * In-process fixed-window counters, with the same window rule as the
 * database (windows start at multiples of windowSec since the epoch).
 * Only for tests, dev and the single-process local backend: several
 * instances each keep their own counts.
 */
export class MemoryStore implements RateLimitStore {
  private counts = new Map<string, { windowStart: number; count: number }>();

  constructor(private now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
    const nowSec = this.now() / 1000;
    const windowStart = Math.floor(nowSec / windowSec) * windowSec;
    const mapKey = `${windowSec}:${key}`;

    const entry = this.counts.get(mapKey);
    const count = entry && entry.windowStart === windowStart ? entry.count + 1 : 1;
    this.counts.set(mapKey, { windowStart, count });
    this.dropExpired(nowSec);

    if (count <= limit) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(windowStart + windowSec - nowSec)) };
  }

  private dropExpired(nowSec: number) {
    if (this.counts.size < 10_000) return;
    for (const [mapKey, entry] of this.counts) {
      const windowSec = Number(mapKey.slice(0, mapKey.indexOf(":")));
      if (entry.windowStart + windowSec <= nowSec) this.counts.delete(mapKey);
    }
  }
}
