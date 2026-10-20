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
 * NOTE: as of this change only auth/session use Supabase; the data actions
 * still read and write the local store (Supabase data layer is a follow-up).
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

export function getBackend(env: Env = process.env): Backend {
  const requested = (env.SPELLBRANCH_BACKEND ?? "").trim().toLowerCase();

  if (requested === "" || requested === "local") return "local";

  if (requested === "supabase") {
    if (!hasSupabaseKeys(env)) {
      throw new Error(
        "SPELLBRANCH_BACKEND=supabase but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing or placeholders.",
      );
    }
    return "supabase";
  }

  throw new Error(
    `Unknown SPELLBRANCH_BACKEND "${requested}". Use "local" (default) or "supabase".`,
  );
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
