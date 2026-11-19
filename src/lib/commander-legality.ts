/**
 * Front-face commander type line. Same shape as
 * decks_commander_legendary_creature in supabase/migrations/018_precons.sql.
 *
 * Whitespace is the six ASCII characters, not `\s`: JavaScript's `\s` matches
 * NBSP, and Postgres's `\s` depends on the locale. Either could accept what
 * the other rejects (Cipher I2, migration 007).
 */
const PG_SPACE = "[ \\t\\n\\r\\f\\v]";

function typeWord(token: string): RegExp {
  return new RegExp(`(^|${PG_SPACE})${token}(${PG_SPACE}|$)`);
}

/** Legendary creature, planeswalker, or spacecraft on the front face. */
export function isLegalCommanderTypeLine(typeLine: string | null | undefined): boolean {
  if (typeof typeLine !== "string") return false;
  const front = typeLine.split("//")[0] ?? "";
  const types = front.split("—")[0] ?? "";
  const subtypes = front.split("—")[1] ?? "";
  if (!typeWord("Legendary").test(types)) return false;
  if (typeWord("Creature").test(types) || typeWord("Planeswalker").test(types)) return true;
  return typeWord("Artifact").test(types) && typeWord("Spacecraft").test(subtypes);
}
