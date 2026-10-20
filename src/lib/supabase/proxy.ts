import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Refreshes the Supabase auth session on each matched request so Server
 * Components see a valid token. No-op on the local backend.
 *
 * This only refreshes cookies; it does not gate routes. Pages and server
 * actions enforce auth via getSessionUser()/requireUser().
 */
export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  const { url, key } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  // New client per request (never module-global).
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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
