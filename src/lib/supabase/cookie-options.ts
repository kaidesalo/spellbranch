import type { CookieOptionsWithName } from "@supabase/ssr";

type Env = Record<string, string | undefined>;

/**
 * Cookie attributes for the Supabase auth cookies (sb-<ref>-auth-token[.N]).
 *
 * @supabase/ssr merges these over its defaults ({ path: "/", sameSite: "lax",
 * httpOnly: false, maxAge: 400 days }) for every cookie it sets or clears, and
 * hands the merged options to our setAll(). Both the server client
 * (src/lib/supabase/server.ts) and the proxy client (src/lib/supabase/proxy.ts)
 * MUST use this same object, or a refresh in one place would rewrite the cookie
 * with different attributes.
 *
 * httpOnly: true means no browser-side Supabase client can read the session.
 * That is intentional: the app only talks to Supabase from the server. Do not
 * add a createBrowserClient() without revisiting this.
 */
export function buildSupabaseCookieOptions(env: Env = process.env): CookieOptionsWithName {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

export const SUPABASE_COOKIE_OPTIONS: Readonly<CookieOptionsWithName> = Object.freeze(
  buildSupabaseCookieOptions(),
);
