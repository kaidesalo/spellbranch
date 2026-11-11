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
  // Each "add card" fetches the card from Scryfall so its color identity
  // comes from Scryfall, not the client. Roomy: building a 100-card deck in
  // one sitting is normal.
  "card-lookup": [
    { by: "ip", limit: 400, windowSec: 10 * MINUTE },
    { by: "user", limit: 200, windowSec: 10 * MINUTE },
  ],
  // Public card search proxy (Cipher PR #9 L2); the picker debounces to 300 ms.
  "scryfall-search": [{ by: "ip", limit: 60, windowSec: MINUTE }],
  // One deck import looks up every pasted name on Scryfall (batched).
  // The cap is on imports, not on cards, so a 100-card list is one attempt.
  "deck-import": [
    { by: "ip", limit: 20, windowSec: 10 * MINUTE },
    { by: "user", limit: 10, windowSec: 10 * MINUTE },
  ],
  // Comments on a deck the caller can already see. A short thread is normal.
  comment: [
    { by: "ip", limit: 60, windowSec: 10 * MINUTE },
    { by: "user", limit: 30, windowSec: 10 * MINUTE },
  ],
  // Send, accept, decline, or remove a friend request.
  "friend-write": [
    { by: "ip", limit: 60, windowSec: 10 * MINUTE },
    { by: "user", limit: 30, windowSec: 10 * MINUTE },
  ],
  // Display name and bio. People do not rewrite a profile in a loop.
  "profile-write": [
    { by: "ip", limit: 20, windowSec: HOUR },
    { by: "user", limit: 10, windowSec: HOUR },
  ],
  // Collection edits that do not call Scryfall: quantity, finish, trade
  // flag, visibility, and deletes. Adding a card stays on card-lookup.
  "collection-write": [
    { by: "ip", limit: 300, windowSec: 10 * MINUTE },
    { by: "user", limit: 150, windowSec: 10 * MINUTE },
  ],
  // Create a deck, edit its name/colors/visibility, delete it, or pick a
  // preferred branch.
  "deck-write": [
    { by: "ip", limit: 40, windowSec: 10 * MINUTE },
    { by: "user", limit: 20, windowSec: 10 * MINUTE },
  ],
  // Quantity, board, category, and section edits while building a deck.
  // Roomy on purpose: tapping + on a hundred cards is one sitting.
  "deck-edit": [
    { by: "ip", limit: 400, windowSec: 10 * MINUTE },
    { by: "user", limit: 200, windowSec: 10 * MINUTE },
  ],
  // Save or remove a favorite.
  "favorite-write": [
    { by: "ip", limit: 120, windowSec: 10 * MINUTE },
    { by: "user", limit: 60, windowSec: 10 * MINUTE },
  ],
  // Public profile pages (/u/{username}), including the for-trade list.
  "profile-view": [{ by: "ip", limit: 60, windowSec: MINUTE }],
  // Deck-stats Scryfall cache misses. A repeat view of the same printings
  // is a cache hit and is not counted. Anonymous viewers use a per-IP user
  // bucket (there is no account id).
  "deck-stats": [
    { by: "ip", limit: 60, windowSec: 10 * MINUTE },
    { by: "user", limit: 40, windowSec: 10 * MINUTE },
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
