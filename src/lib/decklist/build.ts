import { cardFromScryfall } from "@/lib/card-from-scryfall";
import { commanderFromScryfall } from "@/lib/commander";
import type { CardInput } from "@/lib/data/types";
import { normalizeDeckColors } from "@/lib/deck-colors";
import { MAX_CARD_QUANTITY } from "@/lib/deck-quantity";
import { cardLookupKey, cardNameMatchKey, printedFaceNames } from "@/lib/decklist/names";
import type { DecklistCard, ParsedDecklist } from "@/lib/decklist/parse";
import type { ScryfallCard } from "@/lib/scryfall/client";
import type { DeckCommander, DeckFormat } from "@/lib/types";

/**
 * Turns a parsed list plus cards fetched from Scryfall into the rows
 * Spellbranch already stores. Names, types and color identity come from
 * Scryfall (cardFromScryfall / commanderFromScryfall), the same builders
 * add-card and set-commander use. Nothing from the paste is stored except
 * the quantity.
 *
 * Spellbranch has one commander: a legendary creature, planeswalker, or
 * spacecraft. Extra
 * commanders and anything that can't sit in the command zone go into the
 * deck list so the card isn't lost.
 */

export interface BuiltImport {
  commander: DeckCommander | null;
  cards: CardInput[];
  /** Deck colors: the union of every kept card and the commander. [] is Colorless. */
  colors: string[];
  warnings: string[];
}

export function buildImportedDeck(input: {
  format: DeckFormat;
  parsed: ParsedDecklist;
  found: readonly ScryfallCard[];
}): BuiltImport {
  const warnings = [...input.parsed.warnings];
  const commanderEntries = input.format === "commander" ? input.parsed.commanders : [];
  const listEntries: DecklistCard[] = input.parsed.cards.map((card) => ({ ...card }));
  if (input.format !== "commander" && input.parsed.commanders.length > 0) {
    warnings.push("This format has no commander, so those cards were added to the deck list.");
    for (const card of input.parsed.commanders) mergeEntry(listEntries, card);
  }

  const index = indexScryfall(input.found);
  const cards: CardInput[] = [];
  let commander: DeckCommander | null = null;

  for (const entry of commanderEntries) {
    const found = lookupImportedCard(index, entry.name);
    if (!found) {
      warnings.push(`Couldn't find ${entry.name} on Scryfall.`);
      continue;
    }
    const asCommander = commanderFromScryfall(found);
    if (asCommander && !commander) {
      commander = asCommander;
      if (entry.quantity > 1) {
        warnings.push(`Only one copy of ${found.name} can be the commander.`);
      }
      continue;
    }
    const asCard = cardFromScryfall(found, entry.quantity);
    if (!asCard) {
      warnings.push(`Couldn't add ${found.name}.`);
      continue;
    }
    warnings.push(
      asCommander
        ? `Spellbranch keeps a single commander, so ${found.name} was added to the deck list.`
        : `${found.name} can't be a commander, so it was added to the deck list instead of the command zone.`,
    );
    pushCard(cards, asCard, warnings);
  }

  for (const entry of listEntries) {
    const found = lookupImportedCard(index, entry.name);
    if (!found) {
      warnings.push(`Couldn't find ${entry.name} on Scryfall.`);
      continue;
    }
    const asCard = cardFromScryfall(found, entry.quantity);
    if (!asCard) {
      warnings.push(`Couldn't add ${found.name}.`);
      continue;
    }
    pushCard(cards, asCard, warnings);
  }

  const colors = normalizeDeckColors([
    ...(commander?.colorIdentity ?? []),
    ...cards.flatMap((card) => card.colorIdentity),
  ]);
  return { commander, cards, warnings, colors };
}

function mergeEntry(list: DecklistCard[], card: DecklistCard) {
  const key = cardLookupKey(card.name);
  const existing = list.find((row) => cardLookupKey(row.name) === key);
  if (existing) existing.quantity = Math.min(MAX_CARD_QUANTITY, existing.quantity + card.quantity);
  else list.push({ ...card });
}

function indexScryfall(cards: readonly ScryfallCard[]): Map<string, ScryfallCard> {
  const map = new Map<string, ScryfallCard>();
  for (const card of cards) {
    const names = [
      card.name,
      ...(card.card_faces ?? []).flatMap((face) => (face.name ? [face.name] : [])),
    ];
    for (const name of names) {
      const key = cardNameMatchKey(name);
      if (key && !map.has(key)) map.set(key, card);
    }
  }
  return map;
}

/**
 * The Scryfall card for one pasted line. The printed name and each face
 * are indexed with punctuation folded, so "A // B", "A / B", "a//b", and
 * a comma-stripped face all meet the card search would return.
 *
 * Meld cards are not named "A // B". A line written that way still
 * resolves to the front part when every other face is one of that card's
 * parts. A made-up back face does not, so "Sol Ring // Not a Card" is
 * not stored as Sol Ring.
 */
function lookupImportedCard(index: Map<string, ScryfallCard>, name: string): ScryfallCard | undefined {
  const direct = index.get(cardNameMatchKey(name));
  if (direct) return direct;
  const faces = printedFaceNames(name);
  if (faces.length < 2) return undefined;

  const seen = new Set<string>();
  const viable: ScryfallCard[] = [];
  for (const face of faces) {
    const card = index.get(cardNameMatchKey(face));
    if (!card || seen.has(card.id)) continue;
    const namedFace = faces.some((part) => cardNameMatchKey(card.name) === cardNameMatchKey(part));
    const covers = faces.every(
      (part) => cardNameMatchKey(card.name) === cardNameMatchKey(part) || cardMentions(card, part),
    );
    if (!namedFace || !covers) continue;
    seen.add(card.id);
    viable.push(card);
  }
  return viable.find((card) => cardNameMatchKey(card.name) === cardNameMatchKey(faces[0])) ?? viable[0];
}

function cardMentions(card: ScryfallCard, face: string): boolean {
  const key = cardNameMatchKey(face);
  if (!key) return false;
  for (const part of card.card_faces ?? []) {
    if (part.name && cardNameMatchKey(part.name) === key) return true;
  }
  for (const part of card.all_parts ?? []) {
    if (part.name && cardNameMatchKey(part.name) === key) return true;
  }
  return false;
}

function pushCard(cards: CardInput[], card: CardInput, warnings: string[]) {
  const existing = cards.find((row) => row.scryfallId === card.scryfallId);
  if (!existing) {
    cards.push(card);
    return;
  }
  const sum = existing.quantity + card.quantity;
  if (sum > MAX_CARD_QUANTITY) {
    existing.quantity = MAX_CARD_QUANTITY;
    warnings.push(`${existing.cardName} was brought down to ${MAX_CARD_QUANTITY} copies.`);
  } else {
    existing.quantity = sum;
  }
}
