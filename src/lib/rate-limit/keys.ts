import { createHmac } from "node:crypto";
import { rateLimitSecretProblem } from "@/lib/rate-limit/config";
import type { BucketKind, PolicyName } from "@/lib/rate-limit/policies";

/**
 * Storage keys: HMAC-SHA256 of "v1:<policy>:<bucket>:<value>" with
 * SPELLBRANCH_RATE_LIMIT_SECRET, as 64 hex characters. No raw email, IP or
 * user id is ever stored. A plain SHA-256 of an IPv4 address could be
 * reversed by trying all 2^32 of them; the secret prevents that.
 *
 * Rotating the secret changes every key, which resets every counter. Don't
 * rotate it during an attack.
 */

type Env = Record<string, string | undefined>;

const DEV_SECRET = "spellbranch-dev-only-rate-limit-secret-not-for-production";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

let warnedDevSecret = false;

export function getRateLimitSecret(env: Env = process.env): string {
  const problem = rateLimitSecretProblem(env);
  if (!problem) return env.SPELLBRANCH_RATE_LIMIT_SECRET!.trim();
  if (env.NODE_ENV === "production") throw new Error(problem);
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    console.warn(`[spellbranch] ${problem}; using an insecure dev-only rate-limit secret`);
  }
  return DEV_SECRET;
}

export function bucketKey(
  secret: string,
  policy: PolicyName,
  by: BucketKind,
  value: string,
): string {
  return createHmac("sha256", secret).update(`v1:${policy}:${by}:${value}`).digest("hex");
}
