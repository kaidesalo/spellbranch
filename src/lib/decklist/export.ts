import { normalizeBoard, type DeckBoard } from "@/lib/deck-boards";
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
  /** Omitted means mainboard. Side and maybe are written under their own headings. */
  board?: DeckBoard | null;
}

const SECTION_HEADING: Record<Exclude<DeckBoard, "main">, string> = {
  side: "SIDEBOARD",
  maybe: "MAYBEBOARD",
};

function sectionLines(cards: readonly ExportDeckCard[], board: DeckBoard): string[] {
  const merged = new Map<string, { name: string; quantity: number }>();
  for (const card of cards) {
    if (normalizeBoard(card.board) !== board) continue;
    const name = card.cardName.trim();
    if (!name || !Number.isFinite(card.quantity) || card.quantity < 1) continue;
    const key = cardLookupKey(name);
    const quantity = clampQuantity(Math.floor(card.quantity));
    const existing = merged.get(key);
    if (existing) existing.quantity = Math.min(MAX_CARD_QUANTITY, existing.quantity + quantity);
    else merged.set(key, { name, quantity });
  }
  return [...merged.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((card) => `${card.quantity} ${card.name}`);
}

export function exportDecklist(input: {
  commanderName?: string | null;
  cards: readonly ExportDeckCard[];
}): string {
  const lines: string[] = [];
  const commander = input.commanderName?.trim() ?? "";
  if (commander) lines.push(`1 ${commander}`, "");

  lines.push(...sectionLines(input.cards, "main"));

  for (const board of ["side", "maybe"] as const) {
    const section = sectionLines(input.cards, board);
    if (section.length === 0) continue;
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(SECTION_HEADING[board], ...section);
  }

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
