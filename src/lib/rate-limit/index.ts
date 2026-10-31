import "server-only";

import { headers } from "next/headers";
import { getClientIp } from "@/lib/rate-limit/client-ip";
import { bucketKey, getRateLimitSecret, normalizeEmail } from "@/lib/rate-limit/keys";
import { MemoryStore } from "@/lib/rate-limit/memory-store";
import { PostgresStore } from "@/lib/rate-limit/postgres-store";
import { POLICIES, retryAfterFor, type Bucket, type PolicyName } from "@/lib/rate-limit/policies";
import type { HitResult, RateLimitStore } from "@/lib/rate-limit/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { rateLimitHit } from "@/lib/supabase/service";

/**
 * The one entry point for rate limiting (review M1, Cipher F4).
 *
 *   const result = await limit("sign-in", { ip: await requestIp(), email });
 *   if (!result.ok) return limitError(result);
 *
 * Callers name a policy and pass identifiers; they never choose limits or see
 * storage keys. This is a server-only module, NOT "use server": nothing here
 * may be re-exported from an action file (tests/rate-limit-boundary.test.ts).
 *
 * Fails closed: if the store errors or takes longer than STORE_TIMEOUT_MS,
 * the attempt is refused with a generic "try again shortly".
 */

export type LimitIds = { ip: string; email?: string; userId?: string };

export type LimitResult =
  | { ok: true }
  | { ok: false; reason: "limited"; retryAfterSec: number }
  | { ok: false; reason: "unavailable" };

import { RATE_LIMITED_MESSAGE, RATE_LIMIT_UNAVAILABLE_MESSAGE } from "@/lib/rate-limit/messages";

export { RATE_LIMITED_MESSAGE, RATE_LIMIT_UNAVAILABLE_MESSAGE };

const STORE_TIMEOUT_MS = 2500;

let storeOverride: RateLimitStore | null = null;
let timeoutMs = STORE_TIMEOUT_MS;
let memoryStore: MemoryStore | null = null;
let postgresStore: PostgresStore | null = null;

/**
 * Supabase mode: counters in Postgres (rate_limit_hit(), migration 004) via
 * the server-only secret-key client, shared by every server instance.
 * Local mode: in this process (the local backend is single-process anyway).
 */
function getStore(): RateLimitStore {
  if (storeOverride) return storeOverride;
  if (isSupabaseConfigured()) {
    postgresStore ??= new PostgresStore(rateLimitHit);
    return postgresStore;
  }
  memoryStore ??= new MemoryStore();
  return memoryStore;
}

/** Test hook: swap the store and/or the timeout. Pass nothing to reset. */
export function setRateLimitStoreForTests(store: RateLimitStore | null = null, storeTimeoutMs = STORE_TIMEOUT_MS) {
  storeOverride = store;
  timeoutMs = storeTimeoutMs;
  memoryStore = null;
  postgresStore = null;
}

/** The client IP bucket for the current request (server actions). */
export async function requestIp(): Promise<string> {
  return getClientIp(await headers());
}

export async function limit(policy: PolicyName, ids: LimitIds): Promise<LimitResult> {
  try {
    const secret = getRateLimitSecret();
    const store = getStore();
    // In order, stopping at the first block (see policies.ts).
    for (const bucket of POLICIES[policy] as readonly Bucket[]) {
      const key = bucketKey(secret, policy, bucket.by, bucketValue(bucket, ids));
      const hit = await hitWithTimeout(store, key, bucket);
      if (!hit.allowed) return { ok: false, reason: "limited", retryAfterSec: retryAfterFor(policy) };
    }
    return { ok: true };
  } catch (err) {
    // Never log keys, emails or IPs.
    console.error(
      `[spellbranch] rate limit store error (${policy}):`,
      err instanceof Error ? err.message : "unknown error",
    );
    return { ok: false, reason: "unavailable" };
  }
}

type Refused = Exclude<LimitResult, { ok: true }>;

/** The user-facing text for a refused attempt. */
export function limitMessage(result: Refused): string {
  return result.reason === "limited" ? RATE_LIMITED_MESSAGE : RATE_LIMIT_UNAVAILABLE_MESSAGE;
}

/** A refused attempt as a server-action result: { error, retryAfterSec? }. */
export function limitError(result: Refused): { error: string; retryAfterSec?: number } {
  if (result.reason === "limited") return { error: RATE_LIMITED_MESSAGE, retryAfterSec: result.retryAfterSec };
  return { error: RATE_LIMIT_UNAVAILABLE_MESSAGE };
}

function bucketValue(bucket: Bucket, ids: LimitIds): string {
  switch (bucket.by) {
    case "ip":
      return ids.ip;
    case "email":
      return normalizeEmail(required(ids.email, "email"));
    case "email+ip":
      return `${normalizeEmail(required(ids.email, "email"))}|${ids.ip}`;
    case "user":
      return required(ids.userId, "userId");
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`rate limit policy needs ${name}`);
  return value;
}

async function hitWithTimeout(store: RateLimitStore, key: string, bucket: Bucket): Promise<HitResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("rate limit store timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([store.hit(key, bucket.limit, bucket.windowSec, controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
