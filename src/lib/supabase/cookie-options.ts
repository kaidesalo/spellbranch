import type { CookieOptionsWithName } from "@supabase/ssr";

type Env = Record<string, string | undefined>;

/** 30 days, in seconds. */
export const SUPABASE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

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
 * maxAge is 30 days, not the 400-day library default. A session refresh
 * rewrites the cookie, so someone who keeps using Spellbranch stays signed
 * in. A cookie that sits unused for 30 days is dropped and they sign in again.
 *
 * @supabase/ssr 0.12 spreads these options and then forces maxAge back to
 * 400 days on every write. supabaseCookieWriteOptions() puts 30 days back.
 * A clear (maxAge 0) stays a clear. Both setAll() hooks must use it.
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
    maxAge: SUPABASE_COOKIE_MAX_AGE,
  };
}

export const SUPABASE_COOKIE_OPTIONS: Readonly<CookieOptionsWithName> = Object.freeze(
  buildSupabaseCookieOptions(),
);

/**
 * @supabase/ssr overwrites maxAge with 400 days after merging cookieOptions.
 * Put the 30-day lifetime back on cookies we store. maxAge 0 deletes the cookie.
 */
export function supabaseCookieWriteOptions<T extends { maxAge?: number }>(options: T): T {
  if (options.maxAge === 0) return options;
  return { ...options, maxAge: SUPABASE_COOKIE_MAX_AGE };
}
