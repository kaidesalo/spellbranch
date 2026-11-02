import "server-only";

/**
 * Rate-limit policies (review M1). One row per endpoint; every bucket of a
 * policy must allow the attempt. Buckets are checked in the order listed and
 * checking stops at the first one that blocks (Cipher F6/F7), so put the IP
 * bucket first: an IP that is already blocked can't keep burning someone's
 * email bucket.
 *
 * Fixed windows, counted in the store (Postgres uses the DB clock).
 */

export type BucketKind = "ip" | "email" | "email+ip" | "user";

export type Bucket = { by: BucketKind; limit: number; windowSec: number };

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const POLICIES = {
  "sign-in": [
    { by: "ip", limit: 20, windowSec: 5 * MINUTE },
    { by: "email+ip", limit: 10, windowSec: 15 * MINUTE },
    { by: "email", limit: 50, windowSec: HOUR },
  ],
  "sign-up": [
    { by: "ip", limit: 10, windowSec: HOUR },
    { by: "email", limit: 3, windowSec: HOUR },
  ],
  "username-check": [{ by: "ip", limit: 20, windowSec: 10 * MINUTE }],
  // No reset flow exists yet; this is here so the action uses it when it's built.
  "password-reset": [
    { by: "ip", limit: 5, windowSec: HOUR },
    { by: "email", limit: 3, windowSec: HOUR },
  ],
  confirm: [{ by: "ip", limit: 10, windowSec: 5 * MINUTE }],
  // The database adds its own per-user backstop (60 / 10 min) in find_profile().
  "find-profile": [
    { by: "ip", limit: 60, windowSec: 10 * MINUTE },
    { by: "user", limit: 30, windowSec: 10 * MINUTE },
  ],
  // Each "set commander" makes one Scryfall lookup (Cipher PR #9 L1).
  "commander-lookup": [
    { by: "ip", limit: 60, windowSec: 10 * MINUTE },
    { by: "user", limit: 30, windowSec: 10 * MINUTE },
  ],
} as const satisfies Record<string, readonly Bucket[]>;

export type PolicyName = keyof typeof POLICIES;

/**
 * Retry-After for a blocked attempt: the policy's longest window, whichever
 * bucket tripped, so the answer never tells the caller which bucket that was
 * (Cipher F9.2).
 */
export function retryAfterFor(policy: PolicyName): number {
  return Math.max(...POLICIES[policy].map((b) => b.windowSec));
}
