import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/supabase/config";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

/**
 * Supabase client for Server Components, Server Functions and Route Handlers.
 * Create a new one per request; never share it across requests.
 */
export async function createClient() {
  const { url, key } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    // HttpOnly/Secure/SameSite; shared with the proxy client so both write
    // identical cookie attributes.
    cookieOptions: { ...SUPABASE_COOKIE_OPTIONS },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          // Keep `options` as given: @supabase/ssr has already merged
          // SUPABASE_COOKIE_OPTIONS (and maxAge) into it.
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, which can't set cookies.
          // src/proxy.ts refreshes the session before rendering.
        }
      },
    },
  });
}
