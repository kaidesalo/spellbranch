/**
 * An expected failure whose message is safe to show the user ("You cannot
 * edit this deck"). Actions show DataError messages as-is and replace any
 * other error with a generic message, so raw database/PostgREST errors never
 * reach the UI.
 */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

export function userMessage(err: unknown, fallback: string): string {
  if (err instanceof DataError) return err.message;
  console.error("[spellbranch] data error:", err instanceof Error ? err.message : err);
  return fallback;
}

/** Shown for every commander write the rules refuse (both adapters). */
export const COMMANDER_MESSAGES = {
  notCommanderFormat: "Only Commander decks have a commander",
  notLegendaryCreature: "Your commander must be a legendary creature",
} as const;

/**
 * A deck-colors rule refused the write. `cards` lists the deck cards that
 * don't fit (for narrowing the colors or picking a commander), so the UI can
 * show them; it is empty when the problem is a single card or the commander.
 */
export class DeckColorError extends DataError {
  constructor(
    message: string,
    readonly cards: string[] = [],
  ) {
    super(message);
    this.name = "DeckColorError";
  }
}
