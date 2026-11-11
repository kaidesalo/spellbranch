import { DataError } from "@/lib/data/errors";
import { LIMITS } from "@/lib/data/limits";

/**
 * What fork_deck() and the local adapter append when no name is given.
 * Kept here so the fork form's prefilled default matches that name whenever
 * it fits in the deck-name limit.
 */
export const BRANCH_NAME_SUFFIX = " (branch)";

/** What copy_deck() and the local adapter append when no name is given. */
export const COPY_NAME_SUFFIX = " (copy)";

/**
 * "<source> (branch)", shortened from the source name so the result fits
 * decks.name (1–80). fork_deck() uses the same trim when no name is passed in.
 */
export function defaultBranchName(sourceName: string): string {
  return nameWithSuffix(sourceName, BRANCH_NAME_SUFFIX);
}

/**
 * "<source> (copy)", shortened so the result fits decks.name (1–80).
 * copy_deck() uses the same trim when no name is passed in.
 */
export function defaultCopyName(sourceName: string): string {
  return nameWithSuffix(sourceName, COPY_NAME_SUFFIX);
}

function nameWithSuffix(sourceName: string, suffix: string): string {
  // Code points, not UTF-16 units, so an emoji is one character and is not
  // sliced in half. char_length() in Postgres counts the same way.
  const full = `${sourceName}${suffix}`;
  if (Array.from(full).length <= LIMITS.deckName) return full;
  const room = Math.max(0, LIMITS.deckName - Array.from(suffix).length);
  return `${Array.from(sourceName).slice(0, room).join("")}${suffix}`;
}

/** A message safe to show the user, or null when the trimmed name is usable. */
export function forkNameError(name: string): string | null {
  const trimmed = name.trim();
  // Code points, same as nameWithSuffix and Postgres char_length(). An emoji
  // is one character. String.length would count UTF-16 code units and reject
  // a name the database accepts.
  const chars = Array.from(trimmed).length;
  if (chars < 1) return "Deck name is required";
  if (chars > LIMITS.deckName) {
    return `Deck name must be at most ${LIMITS.deckName} characters`;
  }
  return null;
}

/** Trimmed deck name, or a DataError safe to show the user. */
export function requireForkName(name: string): string {
  const error = forkNameError(name);
  if (error) throw new DataError(error);
  return name.trim();
}
