import { normalizeBoard } from "@/lib/deck-boards";
import type { DeckCard, DeckCommander, DeckWithMeta } from "@/lib/types";

/**
 * What the client-side CompareView gets for each side: only the fields it
 * renders. Everything passed to a client component is serialized into the
 * page, so the full DeckWithMeta (notes, branches with their notes, owner
 * ids...) must not be (Cipher PR #3 review, M1).
 */
export type CompareCard = Pick<
  DeckCard,
  "scryfallId" | "cardName" | "imageUri" | "manaCost" | "typeLine" | "quantity" | "board"
>;

export type CompareCommander = Pick<
  DeckCommander,
  "scryfallId" | "cardName" | "typeLine" | "imageUri"
>;

export interface CompareSide {
  id: string;
  name: string;
  format: string;
  cardCount: number;
  ownerUsername: string | null;
  /** Null unless the deck is a Commander deck with a commander set. */
  commander: CompareCommander | null;
  cards: CompareCard[];
}

export function toCompareSide(deck: DeckWithMeta): CompareSide {
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    cardCount: deck.cardCount ?? 0,
    ownerUsername: deck.owner?.username ?? null,
    commander:
      deck.format === "commander" && deck.commander
        ? {
            scryfallId: deck.commander.scryfallId,
            cardName: deck.commander.cardName,
            typeLine: deck.commander.typeLine,
            imageUri: deck.commander.imageUri,
          }
        : null,
    cards: (deck.cards ?? []).map((c) => ({
      scryfallId: c.scryfallId,
      cardName: c.cardName,
      imageUri: c.imageUri,
      manaCost: c.manaCost,
      typeLine: c.typeLine,
      quantity: c.quantity,
      board: normalizeBoard(c.board),
    })),
  };
}

export type CommanderChange = "none" | "same" | "added" | "removed" | "changed";

/** How the branch's commander differs from the source's. */
export function compareCommanders(
  source: Pick<CompareCommander, "scryfallId"> | null,
  branch: Pick<CompareCommander, "scryfallId"> | null,
): CommanderChange {
  if (!source && !branch) return "none";
  if (!source) return "added";
  if (!branch) return "removed";
  return source.scryfallId === branch.scryfallId ? "same" : "changed";
}
