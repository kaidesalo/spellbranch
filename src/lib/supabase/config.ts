import { assertRateLimitConfig } from "@/lib/rate-limit/config";

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
 *
 * Serving in production (either backend) also needs the rate-limit settings
 * (review M1): SPELLBRANCH_RATE_LIMIT_SECRET and SPELLBRANCH_CLIENT_IP_HEADER.
 * Supabase mode, in dev too, needs SUPABASE_SECRET_KEY (an `sb_secret_...`
 * key, used only by src/lib/supabase/service.ts); local mode never does.
 */

export type Backend = "local" | "supabase";

type Env = Record<string, string | undefined>;

const PLACEHOLDER_MARKERS = ["your-project", "your-anon-key", "your-publishable-key"];

function isRealValue(value: string | undefined): value is string {
  if (!value || !value.trim()) return false;
  return !PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

export function hasSupabaseKeys(env: Env = publicSupabaseEnv()): boolean {
  return (
    isRealValue(env.NEXT_PUBLIC_SUPABASE_URL) &&
    normalizeSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL) !== null &&
    isRealValue(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

/**
 * The two public Supabase variables, read with static `process.env.NAME`
 * references. Next.js inlines NEXT_PUBLIC_ values only where they are written
 * out like this, so the same code works in a browser bundle too.
 */
function publicSupabaseEnv(): Env {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** API paths people paste by mistake (supabase-js adds these itself). */
const SUPABASE_API_SUFFIX = /\/(rest|auth|storage|realtime)\/v1\/*$/i;

/**
 * The project URL supabase-js expects: the bare origin,
 * e.g. "https://abcd.supabase.co".
 *
 * A pasted "https://abcd.supabase.co/rest/v1/" made supabase-js call
 * /rest/v1/rest/v1/rpc/..., which PostgREST answers with PGRST125 (invalid
 * path). This trims whitespace, drops trailing slashes and one trailing
 * /rest/v1, /auth/v1, /storage/v1 or /realtime/v1, and keeps only the origin.
 * Returns null for anything that isn't an http(s) URL.
 * `changed` is true when more than whitespace or a trailing slash was dropped.
 */
export function normalizeSupabaseUrl(
  value: string | undefined,
): { url: string; changed: boolean } | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  const withoutSuffix = trimmed.replace(SUPABASE_API_SUFFIX, "");
  let parsed: URL;
  try {
    parsed = new URL(withoutSuffix);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return { url: parsed.origin, changed: parsed.origin !== trimmed };
}

let warnedAboutUrl = false;

/**
 * True when serving in production. `next build` also runs with
 * NODE_ENV=production and prerenders a few pages (e.g. /_not-found) through
 * the layout; NEXT_PHASE marks that build step, which serves nobody, so the
 * local-mode guard waits for `next start`.
 */
export function isProductionRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build";
}

/**
 * Why SUPABASE_SECRET_KEY can't be used, or null if it looks right. Only the
 * new `sb_secret_...` keys are accepted: a legacy service_role JWT (`eyJ...`)
 * can't be revoked on its own. Never includes the value.
 */
export function secretKeyProblem(key: string | undefined): string | null {
  if (!key || !key.trim()) return "SUPABASE_SECRET_KEY is not set.";
  if (key.trim().startsWith("eyJ")) {
    return "SUPABASE_SECRET_KEY looks like a legacy service_role JWT (eyJ...). Use a secret key (sb_secret_...) instead.";
  }
  if (!key.trim().startsWith("sb_secret_")) return "SUPABASE_SECRET_KEY must be a Supabase secret key (sb_secret_...).";
  if (key.includes("your-secret-key")) return "SUPABASE_SECRET_KEY is still the .env.example placeholder.";
  return null;
}

/**
 * A secret key in a NEXT_PUBLIC_ variable would be shipped to every browser.
 * Refuse to start in any mode. Names the variable, never the value.
 */
function assertNoPublicSecretKey(env: Env) {
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && value?.includes("sb_secret_")) {
      throw new Error(
        `${name} holds a Supabase secret key (sb_secret_...). NEXT_PUBLIC_ variables are sent to the browser; ` +
          "put the secret key in SUPABASE_SECRET_KEY only, and rotate it in the Supabase dashboard.",
      );
    }
  }
}

export function getBackend(env: Env = process.env): Backend {
  assertNoPublicSecretKey(env);
  const requested = (env.SPELLBRANCH_BACKEND ?? "").trim().toLowerCase();

  if (requested === "" || requested === "local") {
    if (isProductionRuntime(env) && env.SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION?.trim() !== "1") {
      throw new Error(
        "The local JSON store backend is for development and demos only and is disabled in production. " +
          "Use SPELLBRANCH_BACKEND=supabase, or set SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1 for a single-process demo.",
      );
    }
    if (isProductionRuntime(env)) assertRateLimitConfig(env);
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
    // The secret key is needed whenever Supabase mode serves requests, dev
    // included (Cipher Q1): without it sign-in and sign-up only fail closed,
    // which is confusing. `next build` serves nobody, so it doesn't need it.
    if (env.NEXT_PHASE !== "phase-production-build") {
      const problem = secretKeyProblem(env.SUPABASE_SECRET_KEY);
      if (problem) throw new Error(`${problem} It is required with SPELLBRANCH_BACKEND=supabase (dev included).`);
    }
    if (isProductionRuntime(env)) assertRateLimitConfig(env);
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

/**
 * The Supabase URL and publishable key for every Supabase client (server.ts,
 * proxy.ts, service.ts, and any future browser client). The URL is always
 * normalized to the bare project origin (normalizeSupabaseUrl).
 */
export function getSupabaseEnv(env: Env = publicSupabaseEnv()): { url: string; key: string } {
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const normalized = isRealValue(rawUrl) ? normalizeSupabaseUrl(rawUrl) : null;
  if (!normalized || !isRealValue(key)) {
    throw new Error("Supabase is not configured");
  }
  if (normalized.changed && !warnedAboutUrl) {
    warnedAboutUrl = true;
    // Never the value itself: only that it was fixed.
    console.warn(
      "NEXT_PUBLIC_SUPABASE_URL had a path (e.g. /rest/v1) after the project origin; it was stripped. " +
        "Set it to the bare project URL.",
    );
  }
  return { url: normalized.url, key };
}
