/**
 * Small input helpers shared by both adapters.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres uuid columns reject anything else; treat it as "not found". */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Same rule as profiles_username_format / find_profile(). */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

/**
 * Card images must be Scryfall CDN URLs (002: deck_cards/favorite_cards
 * image_uri CHECK, review F8). Anything else is dropped rather than failing
 * the insert; the UI falls back to a placeholder.
 */
export function scryfallImageOrNull(uri: string | null | undefined): string | null {
  if (!uri) return null;
  return uri.startsWith("https://cards.scryfall.io/") ? uri : null;
}
