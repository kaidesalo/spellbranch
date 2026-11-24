import type { CardInput } from "@/lib/data/types";
import { normalizeBoard } from "@/lib/deck-boards";
import { normalizeDeckColors } from "@/lib/deck-colors";
import { MAX_CARD_QUANTITY } from "@/lib/deck-quantity";

/** Shown when the caller does not own the deck, or the deck is a precon. */
export const FORK_IMPORT_DENIED = "You cannot edit this deck";

/** An owned deck that is not a branch. Copies are not forks. */
export const FORK_IMPORT_NOT_A_FORK = "Deck lists can only be imported into a branch.";

/**
 * The branch points at an original deck this person cannot read, so the
 * import cannot be compared with it. Nothing is saved.
 */
export const FORK_IMPORT_SOURCE_HIDDEN =
  "The original deck isn't available to compare, so this list wasn't imported.";

/**
 * One row per printing per board, quantities capped. The same printing on
 * two boards stays two rows. Invalid quantities are dropped.
 */
export function preparedForkCards(cards: readonly CardInput[]): CardInput[] {
  const map = new Map<string, CardInput>();
  for (const card of cards) {
    if (!Number.isInteger(card.quantity) || card.quantity < 1) continue;
    const board = normalizeBoard(card.board);
    const key = `${card.scryfallId}\0${board}`;
    const quantity = Math.min(MAX_CARD_QUANTITY, card.quantity);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...card,
        board,
        quantity,
        colors: normalizeDeckColors(card.colors),
        colorIdentity: normalizeDeckColors(card.colorIdentity),
      });
      continue;
    }
    existing.quantity = Math.min(MAX_CARD_QUANTITY, existing.quantity + quantity);
  }
  return [...map.values()];
}
