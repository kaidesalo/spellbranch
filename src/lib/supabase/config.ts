/**
 * Backend selection.
 *
 * Spellbranch uses the local JSON store unless BOTH of these are true:
 *   1. SPELLBRANCH_BACKEND=supabase
 *   2. NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are real values
 *
 * Setting the keys alone never switches the app. Asking for Supabase without
 * usable keys (or an unknown backend name) throws, so a misconfiguration fails
 * loudly instead of silently running on the local store.
 *
 * Supabase mode also requires SPELLBRANCH_SITE_URL (confirmation links and
 * the /auth/confirm Origin check depend on it).
 *
 * Auth and data (decks, cards, friends, favorites, comments) both use
 * Supabase in this mode (src/lib/data/supabase.ts, under RLS). Production
 * still refuses to run in Supabase mode unless SPELLBRANCH_ALLOW_HYBRID=1:
 * auth rate limiting (review M1) is open and the data layer hasn't been
 * tested against a live project yet. The variable keeps its old name so
 * existing setups don't change.
 *
 * Local mode is for development and demos only (single process, one JSON
 * file). Production refuses it unless SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1
 * (Cipher PR #3 review, H1). Both guards only look at NODE_ENV, so `next dev`
 * or a custom non-"production" NODE_ENV is not blocked.
 */

export type Backend = "local" | "supabase";

type Env = Record<string, string | undefined>;

const PLACEHOLDER_MARKERS = ["your-project", "your-anon-key", "your-publishable-key"];

function isRealValue(value: string | undefined): value is string {
  if (!value || !value.trim()) return false;
  return !PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

export function hasSupabaseKeys(env: Env = process.env): boolean {
  return (
    isRealValue(env.NEXT_PUBLIC_SUPABASE_URL) &&
    isRealValue(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

/**
 * True when serving in production. `next build` also runs with
 * NODE_ENV=production and prerenders a few pages (e.g. /_not-found) through
 * the layout; NEXT_PHASE marks that build step, which serves nobody, so the
 * local-mode guard waits for `next start`.
 */
export function isProductionRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build";
}

export function getBackend(env: Env = process.env): Backend {
  const requested = (env.SPELLBRANCH_BACKEND ?? "").trim().toLowerCase();

  if (requested === "" || requested === "local") {
    if (isProductionRuntime(env) && env.SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION?.trim() !== "1") {
      throw new Error(
        "The local JSON store backend is for development and demos only and is disabled in production. " +
          "Use SPELLBRANCH_BACKEND=supabase, or set SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1 for a single-process demo.",
      );
    }
    return "local";
  }

  if (requested === "supabase") {
    if (!hasSupabaseKeys(env)) {
      throw new Error(
        "SPELLBRANCH_BACKEND=supabase but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing or placeholders.",
      );
    }
    if (parseSiteUrl(env.SPELLBRANCH_SITE_URL) === null) {
      throw new Error(
        "SPELLBRANCH_BACKEND=supabase requires SPELLBRANCH_SITE_URL (the app's public origin, e.g. https://spellbranch.example).",
      );
    }
    if (env.NODE_ENV === "production" && env.SPELLBRANCH_ALLOW_HYBRID?.trim() !== "1") {
      throw new Error(
        "SPELLBRANCH_BACKEND=supabase is not cleared for production yet (auth rate limiting, review M1, is still open). " +
          "Set SPELLBRANCH_ALLOW_HYBRID=1 to override (not for shared deploys).",
      );
    }
    return "supabase";
  }

  throw new Error(
    `Unknown SPELLBRANCH_BACKEND "${requested}". Use "local" (default) or "supabase".`,
  );
}

/** Parses an http(s) URL and returns its origin (no trailing slash), else null. */
export function parseSiteUrl(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The configured public origin (SPELLBRANCH_SITE_URL), or null if unset/invalid. */
export function getSiteOrigin(env: Env = process.env): string | null {
  return parseSiteUrl(env.SPELLBRANCH_SITE_URL);
}

export function isSupabaseConfigured(env: Env = process.env): boolean {
  return getBackend(env) === "supabase";
}

export function getSupabaseEnv(env: Env = process.env): { url: string; key: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!isRealValue(url) || !isRealValue(key)) {
    throw new Error("Supabase is not configured");
  }
  return { url, key };
}
