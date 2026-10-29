import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { USERNAME_RE } from "@/lib/data/validation";
import { getSupabaseEnv, secretKeyProblem } from "@/lib/supabase/config";

/**
 * The ONE place that uses SUPABASE_SECRET_KEY (review M1/I2, Cipher F4).
 *
 * The secret key bypasses RLS, so this module stays deliberately small:
 *   - server-only (importing it from a client component fails the build);
 *   - plain supabase-js with no session: no cookies, no refresh, and it never
 *     calls `.auth.*`. Who the user is always comes from the cookie client;
 *   - it exports two typed functions for two RPCs and nothing else (no client,
 *     no generic `rpc`), so no caller can run other queries with it;
 *   - only src/lib/rate-limit/index.ts and src/lib/supabase/username.ts may
 *     import it (ESLint no-restricted-imports + tests/service-client.test.ts),
 *     never a "use server" file, a route or a component.
 */

let client: SupabaseClient | null = null;

function serviceClient(): SupabaseClient {
  if (client) return client;
  const problem = secretKeyProblem(process.env.SUPABASE_SECRET_KEY);
  if (problem) throw new Error(problem);
  const { url } = getSupabaseEnv();
  client = createClient(url, process.env.SUPABASE_SECRET_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

type RpcError = { code?: string; message?: string } | null;

/** public.rate_limit_hit() from migration 004 (service_role only). */
export async function rateLimitHit(
  args: { p_key: string; p_limit: number; p_window_seconds: number },
  signal?: AbortSignal,
): Promise<{ data: unknown; error: RpcError }> {
  const query = serviceClient().rpc("rate_limit_hit", args);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  return { data, error: error ? { code: error.code, message: error.message } : null };
}

/**
 * public.username_available() (service_role only since migration 005).
 * Re-checks the username format first, so only valid names reach the
 * database; an invalid name is "not available", as the function itself says.
 */
export async function usernameAvailable(candidate: string): Promise<{ data: unknown; error: RpcError }> {
  if (typeof candidate !== "string" || !USERNAME_RE.test(candidate)) return { data: false, error: null };
  const { data, error } = await serviceClient().rpc("username_available", { candidate });
  return { data, error: error ? { code: error.code, message: error.message } : null };
}

