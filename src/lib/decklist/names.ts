/**
 * Card-name cleanup shared by the decklist parser and the Scryfall name
 * lookup. No I/O. Apostrophes are folded to ASCII so a curly apostrophe
 * from a pasted list still matches Scryfall's name.
 */

const CURLY_APOSTROPHE = /[\u2018\u2019\u201A\u201B\u2032`´]/g;

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
