/**
 * Sign-up username check for the Supabase backend.
 *
 * Calls the `username_available(candidate text) returns boolean` RPC from
 * migration 002. It is SECURITY DEFINER and granted to anon, so it is
 * authoritative even before the visitor has an account, and it only ever
 * returns a boolean (exact, case-insensitive match; invalid names -> false).
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

/** Minimal slice of SupabaseClient used here (keeps tests easy to mock). */
export type UsernameRpcClient = {
  rpc: (
    fn: "username_available",
    args: { candidate: string },
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function checkUsernameAvailable(
  client: UsernameRpcClient,
  candidate: string,
): Promise<UsernameAvailability> {
  try {
    const { data, error } = await client.rpc("username_available", { candidate });
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
