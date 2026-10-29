import "server-only";

import { usernameAvailable } from "@/lib/supabase/service";

/**
 * Sign-up username check for the Supabase backend.
 *
 * Calls the `username_available(candidate text) returns boolean` RPC from
 * migration 002 through the server-only secret-key client: since migration
 * 005 only service_role may call it (review I2), so the app's per-IP limit on
 * the check can't be bypassed by calling PostgREST directly. It is SECURITY
 * DEFINER, so it is authoritative even before the visitor has an account,
 * and it only ever returns a boolean (exact, case-insensitive match; invalid
 * names -> false).
 *
 * This is a pre-check for a friendly error message, not the guarantee: two
 * sign-ups racing for the same name can both see "available". The
 * case-insensitive unique index on profiles (handled in handle_new_user)
 * still resolves that race.
 *
 * Anything other than a clean boolean (an RPC error, a thrown/network error,
 * or an unexpected payload) is "error": we can't verify the name, so callers
 * must NOT treat it as available.
 */

export type UsernameAvailability = "available" | "taken" | "error";

export async function checkUsernameAvailable(candidate: string): Promise<UsernameAvailability> {
  try {
    const { data, error } = await usernameAvailable(candidate);
    if (error) {
      console.error(
        "[spellbranch] username availability check failed:",
        error.message ?? "unknown error",
      );
      return "error";
    }
    if (typeof data !== "boolean") {
      console.error("[spellbranch] username availability check returned an unexpected result");
      return "error";
    }
    return data ? "available" : "taken";
  } catch (err) {
    console.error(
      "[spellbranch] username availability check failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return "error";
  }
}
