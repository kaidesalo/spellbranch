import type { DeckCard, DeckWithMeta } from "@/lib/types";

/**
 * What the client-side CompareView gets for each side: only the fields it
 * renders. Everything passed to a client component is serialized into the
 * page, so the full DeckWithMeta (notes, branches with their notes, owner
 * ids...) must not be (Cipher PR #3 review, M1).
 */
export type CompareCard = Pick<
  DeckCard,
  "scryfallId" | "cardName" | "imageUri" | "manaCost" | "typeLine" | "quantity"
>;

export interface CompareSide {
  id: string;
  name: string;
  format: string;
  cardCount: number;
  ownerUsername: string | null;
  cards: CompareCard[];
}

export function toCompareSide(deck: DeckWithMeta): CompareSide {
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    cardCount: deck.cardCount ?? 0,
    ownerUsername: deck.owner?.username ?? null,
    cards: (deck.cards ?? []).map((c) => ({
      scryfallId: c.scryfallId,
      cardName: c.cardName,
      imageUri: c.imageUri,
      manaCost: c.manaCost,
      typeLine: c.typeLine,
      quantity: c.quantity,
    })),
  };
}
