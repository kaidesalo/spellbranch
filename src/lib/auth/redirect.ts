/**
 * Returns a same-origin relative path that is safe to redirect to, or `fallback`.
 *
 * Rejects absolute URLs (https://evil.test), protocol-relative URLs (//evil.test),
 * backslash tricks (/\evil.test), control characters, and anything that resolves
 * to a different origin or a path starting with "//" after URL normalisation.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;

  const base = "http://spellbranch.invalid";
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base) return fallback;

  const result = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!result.startsWith("/") || result.startsWith("//")) return fallback;
  return result;
}
