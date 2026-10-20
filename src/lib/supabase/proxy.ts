import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/config";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

/**
 * Refreshes the Supabase auth session on each matched request so Server
 * Components see a valid token. No-op on the local backend.
 *
 * This only refreshes cookies; it does not gate routes. Pages and server
 * actions enforce auth via getSessionUser()/requireUser().
 */
export async function updateSession(
  request: NextRequest,
  extraRequestHeaders: Record<string, string> = {},
) {
  // Forward the (possibly cookie-updated) request headers plus any extras
  // (the CSP nonce) to the rest of the app.
  const next = () => {
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(extraRequestHeaders)) headers.set(name, value);
    return NextResponse.next({ request: { headers } });
  };

  if (!isSupabaseConfigured()) {
    return next();
  }

  const { url, key } = getSupabaseEnv();
  let response = next();

  // New client per request (never module-global).
  const supabase = createServerClient(url, key, {
    // Must match src/lib/supabase/server.ts (same shared constant).
    cookieOptions: { ...SUPABASE_COOKIE_OPTIONS },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        // Pass `options` through untouched: it carries HttpOnly/Secure/etc.
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Cache-Control/Expires/Pragma so CDNs never cache a response that sets auth cookies.
        Object.entries(headers ?? {}).forEach(([header, value]) =>
          response.headers.set(header, value),
        );
      },
    },
  });

  // Do not put code between createServerClient and getClaims(): getClaims()
  // verifies the JWT and triggers the refresh that writes new cookies.
  await supabase.auth.getClaims();

  // Must return this exact response object so refreshed cookies reach the browser.
  return response;
}
