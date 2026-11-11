import type { Visibility } from "@/lib/types";

/** A physical pile can be larger than a deck slot. Matches collection_cards_quantity_check. */
export const COLLECTION_MAX_QUANTITY = 9999;

/**
 * Distinct printings (one row per printing and finish) one person may store.
 * Matches collection_cards_limit() in supabase/migrations/016_p3_cleanup.sql.
 * Updates of an existing row do not count. Rows already stored stay if the
 * cap is lowered later; only a new insert is refused.
 */
export const COLLECTION_MAX_ROWS = 5000;

export const COLLECTION_CAP_MESSAGE = `Your collection already has ${COLLECTION_MAX_ROWS} cards`;

export const COLLECTION_FINISHES = ["nonfoil", "foil", "etched"] as const;
export type CollectionFinish = (typeof COLLECTION_FINISHES)[number];

export const COLLECTION_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type CollectionCondition = (typeof COLLECTION_CONDITIONS)[number];

export const FINISH_LABEL: Record<CollectionFinish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};

export const CONDITION_LABEL: Record<CollectionCondition, string> = {
  NM: "Near mint",
  LP: "Lightly played",
  MP: "Moderately played",
  HP: "Heavily played",
  DMG: "Damaged",
};

export type MyCardsSection = "decks" | "branches" | "collection";

export function myCardsSection(value: unknown): MyCardsSection {
  return value === "branches" || value === "collection" ? value : "decks";
}

export type BrowseScope = "friends" | "public" | "on-mine";

export function browseScope(value: unknown): BrowseScope {
  return value === "public" || value === "on-mine" ? value : "friends";
}

export function normalizeFinish(value: unknown): CollectionFinish {
  return value === "foil" || value === "etched" ? value : "nonfoil";
}

export function normalizeCondition(value: unknown): CollectionCondition | null {
  return value === "NM" || value === "LP" || value === "MP" || value === "HP" || value === "DMG"
    ? value
    : null;
}

export function normalizeCollectionVisibility(value: unknown): Visibility {
  return value === "friends" || value === "public" ? value : "private";
}

export function collectionTotals(cards: readonly { quantity: number; forTrade: boolean }[]) {
  const copies = cards.reduce((sum, card) => sum + card.quantity, 0);
  const forTrade = cards.filter((card) => card.forTrade).reduce((sum, card) => sum + card.quantity, 0);
  return { copies, unique: cards.length, forTrade };
}
