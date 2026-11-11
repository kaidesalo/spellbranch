import type { DeckCard } from "@/lib/types";

/**
 * Archidekt-style boards. Mainboard is the deck. Sideboard and Maybeboard
 * are holding areas: they are shown, and they are copied with the deck, but
 * they are not part of the deck's size or its color legality.
 */
export const DECK_BOARDS = ["main", "side", "maybe"] as const;

export type DeckBoard = (typeof DECK_BOARDS)[number];

export const BOARD_LABEL: Record<DeckBoard, string> = {
  main: "Mainboard",
  side: "Sideboard",
  maybe: "Maybeboard",
};

/** Anything that is not side or maybe is the mainboard, including rows saved before boards existed. */
export function normalizeBoard(value: unknown): DeckBoard {
  return value === "side" || value === "maybe" ? value : "main";
}

export function isMainBoard(board: unknown): boolean {
  return normalizeBoard(board) === "main";
}

export function cardsOnBoard(cards: readonly DeckCard[], board: DeckBoard): DeckCard[] {
  return cards.filter((card) => normalizeBoard(card.board) === board);
}

/** Quantity sum. The deck's published size uses the mainboard only. */
export function boardQuantity(cards: readonly DeckCard[], board: DeckBoard): number {
  return cardsOnBoard(cards, board).reduce((sum, card) => sum + card.quantity, 0);
}

export function boardCounts(cards: readonly DeckCard[]): Record<DeckBoard, number> {
  return {
    main: boardQuantity(cards, "main"),
    side: boardQuantity(cards, "side"),
    maybe: boardQuantity(cards, "maybe"),
  };
}

/** The deck's published size: mainboard quantity, including rows saved with no board. */
export function mainboardQuantity(
  cards: readonly { quantity: number; board?: string | null }[],
): number {
  return cards.reduce((sum, card) => sum + (isMainBoard(card.board) ? card.quantity : 0), 0);
}
