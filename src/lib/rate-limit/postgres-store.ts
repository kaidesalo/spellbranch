import type { HitResult, RateLimitStore } from "@/lib/rate-limit/store";

/**
 * Counters in Postgres, via public.rate_limit_hit(p_key, p_limit,
 * p_window_seconds) from migration 004. The function only accepts
 * service_role, so the rpc passed in must come from the server-only
 * secret-key client (pending: see README "Rate limiting status").
 *
 * The rpc is injected so this file never creates a Supabase client itself.
 */
export type RateLimitRpcArgs = { p_key: string; p_limit: number; p_window_seconds: number };

export type RateLimitRpc = (
  args: RateLimitRpcArgs,
  signal?: AbortSignal,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

type Row = { allowed: unknown; retry_after: unknown };

export class PostgresStore implements RateLimitStore {
  constructor(private rpc: RateLimitRpc) {}

  async hit(key: string, limit: number, windowSec: number, signal?: AbortSignal): Promise<HitResult> {
    const { data, error } = await this.rpc(
      { p_key: key, p_limit: limit, p_window_seconds: windowSec },
      signal,
    );
    // Never include the key in errors or logs.
    if (error) throw new Error(`rate_limit_hit failed${error.code ? ` (${error.code})` : ""}`);

    // "returns table" comes back as an array with one row.
    const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    if (!row || typeof row.allowed !== "boolean" || typeof row.retry_after !== "number") {
      throw new Error("rate_limit_hit returned an unexpected result");
    }
    return { allowed: row.allowed, retryAfterSec: row.retry_after };
  }
}
