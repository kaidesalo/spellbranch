import { CARD_COLORS, LIMITS } from "@/lib/data/limits";
import { isUuid, scryfallImageOrNull } from "@/lib/data/validation";
import { getCardImage, getCardManaCost, type ScryfallCard } from "@/lib/scryfall/client";
import type { DeckCommander } from "@/lib/types";

/**
 * Commander rules shared by the server action, both data adapters, the
 * Scryfall search filter and the UI. Plain module (no "server-only"): the
 * checks are pure, and the client only uses them for display.
 *
 * Scope: a single legendary creature. Partner, Background and "can be your
 * commander" planeswalkers are out of scope for now.
 */

/** The front face of a type line ("A // B" -> "A"). */
export function frontFaceTypeLine(typeLine: string): string {
  return typeLine.split("//")[0]!.trim();
}

/**
 * True when the front face's card types (the part before the em dash) include
 * both the Legendary supertype and the Creature type. Whole words and
 * case-sensitive, like Oracle text: "Legendary Enchantment Creature — God"
 * passes; "Legendary Artifact", "Creature — Legendary" and "legendary
 * creature" do not. Same rule as the decks_commander_legendary_creature
 * CHECK in supabase/migrations/006_deck_commander.sql.
 */
export function isLegendaryCreatureTypeLine(typeLine: string | null | undefined): boolean {
  if (typeof typeLine !== "string") return false;
  const types = frontFaceTypeLine(typeLine).split("—")[0]!;
  return /(^|\s)Legendary(\s|$)/.test(types) && /(^|\s)Creature(\s|$)/.test(types);
}

/** The type line Scryfall shows for the card's front face. */
export function scryfallFrontTypeLine(card: ScryfallCard): string {
  return frontFaceTypeLine(card.card_faces?.[0]?.type_line ?? card.type_line ?? "");
}

export function isLegendaryCreatureCard(card: ScryfallCard): boolean {
  return isLegendaryCreatureTypeLine(scryfallFrontTypeLine(card));
}

/** W/U/B/R/G only, once each, in WUBRG order. */
export function normalizeColorIdentity(colors: readonly unknown[] | null | undefined): string[] {
  const set = new Set((colors ?? []).filter((c): c is string => typeof c === "string"));
  return CARD_COLORS.filter((c) => set.has(c));
}

function artCrop(card: ScryfallCard): string | null {
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null;
}

/**
 * Builds the stored commander from a card fetched from Scryfall on the
 * server. Returns null if the card can't be a commander (not a legendary
 * creature) or doesn't fit the column limits.
 */
export function commanderFromScryfall(card: ScryfallCard): DeckCommander | null {
  if (!isUuid(card.id) || typeof card.name !== "string") return null;
  const typeLine = scryfallFrontTypeLine(card);
  if (!isLegendaryCreatureTypeLine(typeLine)) return null;
  const manaCost = getCardManaCost(card);
  if (
    card.name.length === 0 ||
    card.name.length > LIMITS.cardName ||
    typeLine.length > LIMITS.typeLine ||
    (manaCost !== null && manaCost.length > LIMITS.manaCost)
  ) {
    return null;
  }
  const image = scryfallImageOrNull(getCardImage(card));
  const art = scryfallImageOrNull(artCrop(card));
  return {
    scryfallId: card.id.toLowerCase(),
    cardName: card.name,
    typeLine,
    manaCost,
    imageUri: image && image.length <= LIMITS.imageUri ? image : null,
    artUri: art && art.length <= LIMITS.imageUri ? art : null,
    colorIdentity: normalizeColorIdentity(card.color_identity),
  };
}

/** "1 commander + 99 cards" / "60 cards". */
export function deckCountLabel(cardCount: number, hasCommander: boolean): string {
  const cards = `${cardCount} ${cardCount === 1 ? "card" : "cards"}`;
  return hasCommander ? `1 commander + ${cards}` : cards;
}
