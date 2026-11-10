import { MAX_CARD_QUANTITY, clampQuantity } from "@/lib/deck-quantity";
import { cardLookupKey } from "@/lib/decklist/names";

/**
 * Plain text Moxfield and Archidekt can both import: one `quantity name`
 * line per card, like `1 Sol Ring` or `10 Forest`.
 *
 * When the deck has a commander it is the first line, then a blank line,
 * then the deck. That is Moxfield's plain-text commander mark, and our
 * importer reads it back. Archidekt imports every line as a card; the
 * commander is the first line so it isn't dropped.
 */

export interface ExportDeckCard {
  cardName: string;
  quantity: number;
}

export function exportDecklist(input: {
  commanderName?: string | null;
  cards: readonly ExportDeckCard[];
}): string {
  const lines: string[] = [];
  const commander = input.commanderName?.trim() ?? "";
  if (commander) lines.push(`1 ${commander}`, "");

  const merged = new Map<string, { name: string; quantity: number }>();
  for (const card of input.cards) {
    const name = card.cardName.trim();
    if (!name || !Number.isFinite(card.quantity) || card.quantity < 1) continue;
    const key = cardLookupKey(name);
    const quantity = clampQuantity(Math.floor(card.quantity));
    const existing = merged.get(key);
    if (existing) existing.quantity = Math.min(MAX_CARD_QUANTITY, existing.quantity + quantity);
    else merged.set(key, { name, quantity });
  }

  const cards = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const card of cards) lines.push(`${card.quantity} ${card.name}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** A download name that stays a single file name. */
export function decklistFilename(deckName: string): string {
  const base = deckName
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "deck"}.txt`;
}
