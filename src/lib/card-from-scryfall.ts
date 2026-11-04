import { LIMITS } from "@/lib/data/limits";
import { isUuid, scryfallImageOrNull } from "@/lib/data/validation";
import { normalizeDeckColors } from "@/lib/deck-colors";
import {
  getCardImage,
  getCardManaCost,
  getCardOracleText,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import type { CardInput } from "@/lib/data/types";

/**
 * Builds the deck card to store from a card the server fetched from Scryfall
 * itself (addCardToDeckAction), so the name, text, colors and especially the
 * color identity never come from the client. Same idea as
 * commanderFromScryfall (PR #9/#10).
 *
 * Returns null when the card doesn't fit the deck_cards column limits.
 */
export function cardFromScryfall(card: ScryfallCard, quantity: number): CardInput | null {
  if (!isUuid(card.id) || typeof card.name !== "string" || card.name.length === 0) return null;
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? "";
  const manaCost = getCardManaCost(card);
  const oracleText = getCardOracleText(card);
  if (
    card.name.length > LIMITS.cardName ||
    typeLine.length === 0 ||
    typeLine.length > LIMITS.typeLine ||
    (manaCost !== null && manaCost.length > LIMITS.manaCost) ||
    (oracleText !== null && oracleText.length > LIMITS.oracleText)
  ) {
    return null;
  }
  const image = scryfallImageOrNull(getCardImage(card));
  return {
    scryfallId: card.id.toLowerCase(),
    cardName: card.name,
    imageUri: image && image.length <= LIMITS.imageUri ? image : null,
    manaCost,
    typeLine,
    // Double-faced cards keep colors on the faces; identity covers both.
    colors: normalizeDeckColors(card.colors ?? card.color_identity),
    colorIdentity: normalizeDeckColors(card.color_identity),
    oracleText,
    quantity,
  };
}
