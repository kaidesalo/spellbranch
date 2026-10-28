/**
 * Where counters live. One call = one attempt: the store adds 1 to the
 * counter for (key, current window) and says whether it is still within the
 * limit. Implementations:
 *   - MemoryStore   (memory-store.ts): one process only. Tests, dev, local mode.
 *   - PostgresStore (postgres-store.ts): the rate_limit_hit() RPC from
 *     migration 004, shared by every instance.
 *
 * Only src/lib/rate-limit/index.ts may use a store directly (Cipher F4).
 */
export type HitResult = { allowed: boolean; retryAfterSec: number };

export interface RateLimitStore {
  hit(key: string, limit: number, windowSec: number, signal?: AbortSignal): Promise<HitResult>;
}
