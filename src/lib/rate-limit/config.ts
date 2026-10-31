import "server-only";

/**
 * Rate-limit settings that production checks before serving (review M1,
 * Cipher F1/F10). Called from getBackend(), next to the other production
 * guards, so a misconfiguration fails on the first request after a deploy,
 * not silently at somebody's first sign-in.
 *
 * Plain string checks only (no node: imports), because src/lib/supabase/config.ts
 * is also loaded by the proxy.
 */

type Env = Record<string, string | undefined>;

const MIN_SECRET_BYTES = 32;

/** What's wrong with SPELLBRANCH_RATE_LIMIT_SECRET, or null when it's fine. */
export function rateLimitSecretProblem(env: Env = process.env): string | null {
  const secret = env.SPELLBRANCH_RATE_LIMIT_SECRET?.trim();
  if (!secret) return "SPELLBRANCH_RATE_LIMIT_SECRET is not set";
  if (new TextEncoder().encode(secret).length < MIN_SECRET_BYTES) {
    return `SPELLBRANCH_RATE_LIMIT_SECRET must be at least ${MIN_SECRET_BYTES} bytes (openssl rand -base64 32)`;
  }
  if (env.AUTH_SECRET && secret === env.AUTH_SECRET.trim()) {
    return "SPELLBRANCH_RATE_LIMIT_SECRET must be different from AUTH_SECRET";
  }
  return null;
}

/** Throws a clear configuration error if production can't rate-limit safely. */
export function assertRateLimitConfig(env: Env = process.env): void {
  const secretProblem = rateLimitSecretProblem(env);
  if (secretProblem) throw new Error(`${secretProblem}. It is required in production.`);
  if (!env.SPELLBRANCH_CLIENT_IP_HEADER?.trim()) {
    throw new Error(
      "SPELLBRANCH_CLIENT_IP_HEADER is required in production: the one header your platform sets to the client IP " +
        "(e.g. x-real-ip on Vercel, cf-connecting-ip behind Cloudflare). See README \"Client IP header\".",
    );
  }
}
