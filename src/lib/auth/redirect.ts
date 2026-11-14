/**
 * Returns a same-origin relative path that is safe to redirect to, or `fallback`.
 *
 * The value must start with a single "/". Protocol-relative paths (`//`),
 * backslashes, schemes, control characters, and encoded forms of those
 * (`%2F%2F`, `%5C`, `%00`) are rejected. Decoding is applied a few times so
 * nested encodings cannot sneak a new origin through.
 */
function unsafePath(value: string): boolean {
  return (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("://") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  );
}

export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || raw.includes("\u0000")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  if (/%5c|%00|%2f%2f/i.test(raw)) return fallback;

  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    if (unsafePath(decoded)) return fallback;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return fallback;
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (unsafePath(decoded)) return fallback;

  const base = "http://spellbranch.invalid";
  let parsed: URL;
  try {
    parsed = new URL(decoded, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base) return fallback;

  const result = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!result.startsWith("/") || result.startsWith("//") || result.includes("\\")) return fallback;
  return result;
}
