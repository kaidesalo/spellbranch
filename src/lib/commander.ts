import { LIMITS } from "@/lib/data/limits";
import { normalizeDeckColors } from "@/lib/deck-colors";
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
 * Whitespace exactly as the migration CHECKs spell it: the six ASCII
 * whitespace characters, written out as `[ \t\n\r\f\v]` on both sides.
 * Not `\s`: JavaScript's `\s` matches NBSP and other Unicode spaces, and
 * Postgres's depends on the database locale (it matched U+2003 but not NBSP
 * on PG17 here), so either could accept what the other rejects (Cipher I2).
 */
const PG_SPACE = "[ \\t\\n\\r\\f\\v]";
const LEGENDARY = new RegExp(`(^|${PG_SPACE})Legendary(${PG_SPACE}|$)`);
const CREATURE = new RegExp(`(^|${PG_SPACE})Creature(${PG_SPACE}|$)`);
const NOT_BLANK = /[^ \t\n\r\f\v]/;

/**
 * True when the front face's card types (the part before the em dash) include
 * both the Legendary supertype and the Creature type. Whole words and
 * case-sensitive, like Oracle text: "Legendary Enchantment Creature — God"
 * passes; "Legendary Artifact", "Creature — Legendary" and "legendary
 * creature" do not. Same rule as the decks_commander_legendary_creature
 * CHECK (supabase/migrations/007_deck_commander_hardening.sql).
 */
export function isLegendaryCreatureTypeLine(typeLine: string | null | undefined): boolean {
  if (typeof typeLine !== "string") return false;
  const types = typeLine.split("//")[0]!.split("—")[0]!;
  return LEGENDARY.test(types) && CREATURE.test(types);
}

/** A name with at least one non-whitespace character (decks_commander_name_not_blank). */
export function isNonBlankName(name: string | null | undefined): boolean {
  return typeof name === "string" && NOT_BLANK.test(name);
}

/**
 * Why a commander can't be saved, or null if it can: the rules both
 * adapters re-check before writing (the action builds the commander from
 * Scryfall, but the repository doesn't trust its caller either).
 */
export function commanderProblem(c: DeckCommander): "notLegendaryCreature" | null {
  if (!isLegendaryCreatureTypeLine(c.typeLine) || !isNonBlankName(c.cardName)) {
    return "notLegendaryCreature";
  }
  return null;
}

/** The commander as stored: colors deduplicated in WUBRG order, CDN-only images. */
export function normalizeCommander(c: DeckCommander): DeckCommander {
  return {
    ...c,
    imageUri: scryfallImageOrNull(c.imageUri),
    artUri: scryfallImageOrNull(c.artUri),
    colorIdentity: normalizeColorIdentity(c.colorIdentity),
  };
}

/** The type line Scryfall shows for the card's front face. */
export function scryfallFrontTypeLine(card: ScryfallCard): string {
  return frontFaceTypeLine(card.card_faces?.[0]?.type_line ?? card.type_line ?? "");
}

export function isLegendaryCreatureCard(card: ScryfallCard): boolean {
  return isLegendaryCreatureTypeLine(scryfallFrontTypeLine(card));
}

/**
 * W/U/B/R/G only, once each, in WUBRG order. (Flattens, because a 2-D array
 * from a direct API write reads back nested.) Same as deck colors.
 */
export function normalizeColorIdentity(colors: readonly unknown[] | null | undefined): string[] {
  return normalizeDeckColors(colors);
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
  if (!isUuid(card.id) || !isNonBlankName(card.name)) return null;
  const typeLine = scryfallFrontTypeLine(card);
  if (!isLegendaryCreatureTypeLine(typeLine)) return null;
  const manaCost = getCardManaCost(card);
  if (
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
