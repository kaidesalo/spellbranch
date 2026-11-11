/**
 * Avatar fallback and URL check for profile pages.
 *
 * profiles.avatar_url already exists (migration 001) and must be https
 * (migration 002). There is no storage bucket and no upload yet; a non-https
 * value is dropped so it cannot become an image source. Pinning the host to
 * a storage bucket is a follow-up for when uploads exist.
 */

/** Two-letter initials. Display name first, then the username. */
export function profileInitials(displayName: string, username: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  let raw: string;
  if (words.length >= 2) {
    raw = `${[...words[0]][0] ?? ""}${[...words[words.length - 1]][0] ?? ""}`;
  } else if (words.length === 1) {
    raw = [...words[0]].slice(0, 2).join("");
  } else {
    raw = [...username.trim()].slice(0, 2).join("");
  }
  const letters = raw.toLocaleUpperCase("en-US");
  return letters || "?";
}

/** https only, no embedded credentials. Anything else is treated as no avatar. */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return url;
  } catch {
    return null;
  }
}
