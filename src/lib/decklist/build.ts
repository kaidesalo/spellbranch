import { cardFromScryfall } from "@/lib/card-from-scryfall";
import { commanderFromScryfall } from "@/lib/commander";
import type { CardInput } from "@/lib/data/types";
import { normalizeDeckColors } from "@/lib/deck-colors";
import { MAX_CARD_QUANTITY } from "@/lib/deck-quantity";
import { cardLookupKey } from "@/lib/decklist/names";
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
 * Spellbranch has one commander, and only a legendary creature. Extra
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
    const found = index.get(cardLookupKey(entry.name));
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
        : `${found.name} isn't a legendary creature, so it was added to the deck list instead of the command zone.`,
    );
    pushCard(cards, asCard, warnings);
  }

  for (const entry of listEntries) {
    const found = index.get(cardLookupKey(entry.name));
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
      const key = cardLookupKey(name);
      if (key && !map.has(key)) map.set(key, card);
    }
  }
  return map;
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
