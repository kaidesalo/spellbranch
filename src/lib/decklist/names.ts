/**
 * Card-name cleanup shared by the decklist parser and the Scryfall name
 * lookup. No I/O. Apostrophes are folded to ASCII so a curly apostrophe
 * from a pasted list still matches Scryfall's name.
 */

const CURLY_APOSTROPHE = /[\u2018\u2019\u201A\u201B\u2032`´]/g;
/**
 * Multi-face lists use "A // B", "A//B", "A / B", or "A/B". `//` is tried
 * before a single slash. A slash inside one name ("SP//dr", "Choco/Mog")
 * also splits here; the caller still looks the whole name up.
 */
const FACE_SEPARATOR = /\s*(?:\/\/|\/)\s*/;

/** Trim, fold apostrophes, and space the double-faced "//" separator. */
export function canonicalizePrintedName(name: string): string {
  return name
    .replace(CURLY_APOSTROPHE, "'")
    .replace(/\s*\/\/\s*/g, " // ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-insensitive key for an exact name match. */
export function cardLookupKey(name: string): string {
  return canonicalizePrintedName(name).toLowerCase();
}

/**
 * Same card, written differently. Case, spaces, and punctuation fold away
 * the way Scryfall's collection name match does for a single-faced card
 * ("Lim-Dûl's Vault" and "lim duls vault"), and "A // B", "A / B", and
 * "A/B" fold to one key. "Rin & Seri" does not fold into "Rin and Seri":
 * collection lookup does not treat those as the same name.
 */
export function cardNameMatchKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Faces of a multi-face line, front first. Empty when `name` is one face
 * (no slash). At most five: that is the longest Scryfall split name.
 */
export function printedFaceNames(name: string): string[] {
  const printed = canonicalizePrintedName(name);
  if (!printed.includes("/")) return [];
  const parts = printed.split(FACE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return [];
  if (parts.some((part) => !/\p{L}/u.test(part))) return [];
  return parts;
}

/**
 * Names to send to Scryfall's collection endpoint for one pasted line.
 * The printed line is first. Each face follows, because collection does
 * not resolve a combined "A // B" name — it indexes the faces (and, for
 * a single-faced card, the whole name with slashes folded out).
 */
export function collectionLookupNames(name: string): string[] {
  const printed = canonicalizePrintedName(name);
  if (!printed) return [];
  const faces = printedFaceNames(printed);
  if (faces.length < 2) return [printed];
  return [printed, ...faces];
}
