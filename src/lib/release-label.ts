import "server-only";

/**
 * Footer release label. The site footer is a server component (the root
 * layout reads headers(), so this runs per request). It reads Vercel's
 * `VERCEL_ENV` from the Node process. No hostname check, and nothing has to
 * be added in the Vercel dashboard.
 *
 * Production shows "v1.0", hides the beta disclaimer, and omits the commit
 * hash. Preview, development, and an unset environment keep "Beta", the
 * disclaimer, and the commit hash when the build has one.
 * `NEXT_PUBLIC_VERCEL_ENV` is only a fallback when `VERCEL_ENV` is empty.
 * These are read off the env object on purpose: a direct
 * `process.env.NEXT_PUBLIC_*` reference is inlined at build time, and this
 * label has to follow the deployment that is actually serving the page.
 *
 * Optional, not required, not a secret: `NEXT_PUBLIC_SPELLBRANCH_RELEASE_LABEL`
 * replaces the short label ("v1.0" / "Beta") only. The disclaimer still
 * follows the same production check.
 */

export const PRODUCTION_RELEASE_LABEL = "v1.0";
export const BETA_RELEASE_LABEL = "Beta";
export const BETA_DISCLAIMER =
  "Spellbranch is currently in beta testing. Features may change and data may be reset.";

/** `process.env`, or a stand-in in tests. Same shape `footerRevision` already uses. */
export type ReleaseEnv = Record<string, string | undefined>;

function clean(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Vercel deployment target. The server variable wins over the public fallback. */
export function vercelEnvironment(env: ReleaseEnv = process.env): string {
  return (clean(env.VERCEL_ENV) || clean(env.NEXT_PUBLIC_VERCEL_ENV)).toLowerCase();
}

/** True on Vercel Production. Preview, development, and unset are not production. */
export function isProductionRelease(env: ReleaseEnv = process.env): boolean {
  return vercelEnvironment(env) === "production";
}

/** True everywhere the footer should keep the beta wording. */
export function isBeta(env: ReleaseEnv = process.env): boolean {
  return !isProductionRelease(env);
}

/** Short footer label: "v1.0" on production, "Beta" otherwise, unless overridden. */
export function releaseLabel(env: ReleaseEnv = process.env): string {
  const override = clean(env.NEXT_PUBLIC_SPELLBRANCH_RELEASE_LABEL);
  if (override) return override;
  return isProductionRelease(env) ? PRODUCTION_RELEASE_LABEL : BETA_RELEASE_LABEL;
}

/**
 * The beta-testing sentence, or null on production so the footer can omit it.
 * The optional label override does not change this.
 */
export function releaseDisclaimer(env: ReleaseEnv = process.env): string | null {
  return isBeta(env) ? BETA_DISCLAIMER : null;
}

/**
 * Whether the footer appends the commit id. False on production, so the line
 * ends at the release label with no trailing separator. The optional label
 * override does not change this.
 */
export function showCommit(env: ReleaseEnv = process.env): boolean {
  return !isProductionRelease(env);
}
