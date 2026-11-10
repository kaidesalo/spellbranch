import { DataError } from "@/lib/data/errors";
import { LIMITS } from "@/lib/data/limits";

/**
 * What fork_deck() and the local adapter append when no name is given.
 * Kept here so the fork form's prefilled default matches that name whenever
 * it fits in the deck-name limit.
 */
export const BRANCH_NAME_SUFFIX = " (branch)";

/**
 * "<source> (branch)", shortened from the source name so the result fits
 * decks.name (1–80). fork_deck() itself does not shorten: a source name that
 * already uses the whole limit still fails inside the database function.
 */
export function defaultBranchName(sourceName: string): string {
  const full = `${sourceName}${BRANCH_NAME_SUFFIX}`;
  if (full.length <= LIMITS.deckName) return full;
  const room = Math.max(0, LIMITS.deckName - BRANCH_NAME_SUFFIX.length);
  return `${sourceName.slice(0, room)}${BRANCH_NAME_SUFFIX}`;
}

/** A message safe to show the user, or null when the trimmed name is usable. */
export function forkNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return "Deck name is required";
  if (trimmed.length > LIMITS.deckName) {
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
