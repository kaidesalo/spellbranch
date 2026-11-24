import { compareCommanders, type CommanderChange } from "@/lib/compare-dto";
import { normalizeBoard, type DeckBoard } from "@/lib/deck-boards";
import { compareDeckLists } from "@/lib/deck-diff";

/**
 * How a pasted list, after the existing importer has resolved it, differs
 * from the original deck a branch was forked from.
 *
 * Cards are matched by Scryfall id and board, so the same printing on
 * mainboard and sideboard is two rows. A double-faced card is one row: the
 * front face and the "A // B" name share an id, and the combined name is
 * the one shown. The commander is its own board. It is not a deck-list row.
 */

export type ImportBoard = DeckBoard | "commander";

export interface ImportDiffCard {
  scryfallId: string;
  cardName: string;
  manaCost?: string | null;
  typeLine?: string;
  quantity: number;
  board?: string | null;
}

export interface ImportDiffCommander {
  scryfallId: string;
  cardName: string;
  manaCost?: string | null;
  typeLine?: string;
}

export interface ImportDiffRow {
  scryfallId: string;
  cardName: string;
  manaCost: string | null;
  typeLine: string;
  board: ImportBoard;
  kind: "added" | "removed" | "quantity" | "unchanged";
  originalQty: number;
  importQty: number;
}

export interface ImportDiff {
  /** Every card row, including unchanged, then commander rows that changed. */
  rows: ImportDiffRow[];
  /** Added, removed, and quantity changes, commander included. */
  changes: ImportDiffRow[];
  summary: { added: number; removed: number; quantity: number; unchanged: number };
  commanderChange: CommanderChange;
}

/** Prefer the combined double-faced name when either side has one. */
export function preferDfcName(importedName?: string | null, originalName?: string | null): string {
  const names = [importedName, originalName].filter((name): name is string => Boolean(name?.includes("//")));
  if (names.length > 0) return names[0]!;
  return importedName?.trim() || originalName?.trim() || "";
}

function collapse(cards: readonly ImportDiffCard[]): Map<string, ImportDiffCard> {
  const map = new Map<string, ImportDiffCard>();
  for (const card of cards) {
    const board = normalizeBoard(card.board);
    const key = `${card.scryfallId}\0${board}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...card, board, quantity: card.quantity });
      continue;
    }
    existing.quantity += card.quantity;
    existing.cardName = preferDfcName(card.cardName, existing.cardName);
    if (!existing.typeLine && card.typeLine) existing.typeLine = card.typeLine;
    if (!existing.manaCost && card.manaCost) existing.manaCost = card.manaCost;
  }
  return map;
}

function commanderRow(
  commander: ImportDiffCommander,
  kind: "added" | "removed",
  originalQty: number,
  importQty: number,
): ImportDiffRow {
  return {
    scryfallId: commander.scryfallId,
    cardName: commander.cardName,
    manaCost: commander.manaCost ?? null,
    typeLine: commander.typeLine ?? "",
    board: "commander",
    kind,
    originalQty,
    importQty,
  };
}

export function diffImportAgainstOriginal(input: {
  originalCards: readonly ImportDiffCard[];
  originalCommander: ImportDiffCommander | null;
  importedCards: readonly ImportDiffCard[];
  importedCommander: ImportDiffCommander | null;
}): ImportDiff {
  const original = collapse(input.originalCards);
  const imported = collapse(input.importedCards);
  const asDiffCard = (card: ImportDiffCard) => ({
    scryfallId: card.scryfallId,
    cardName: card.cardName,
    imageUri: null,
    manaCost: card.manaCost ?? null,
    typeLine: card.typeLine ?? "",
    quantity: card.quantity,
    board: normalizeBoard(card.board),
  });
  const diffs = compareDeckLists(
    [...original.values()].map(asDiffCard),
    [...imported.values()].map(asDiffCard),
  );

  const cardRows: ImportDiffRow[] = diffs.map((diff) => {
    const key = `${diff.scryfallId}\0${normalizeBoard(diff.board)}`;
    const source = original.get(key);
    const branch = imported.get(key);
    return {
      scryfallId: diff.scryfallId,
      cardName: preferDfcName(branch?.cardName, source?.cardName) || diff.cardName,
      manaCost: branch?.manaCost ?? source?.manaCost ?? diff.manaCost ?? null,
      typeLine: branch?.typeLine ?? source?.typeLine ?? diff.typeLine ?? "",
      board: normalizeBoard(diff.board),
      kind: diff.kind,
      originalQty: diff.sourceQty,
      importQty: diff.branchQty,
    };
  });

  const commanderChange = compareCommanders(input.originalCommander, input.importedCommander);
  const commanderRows: ImportDiffRow[] = [];
  if (commanderChange === "removed" && input.originalCommander) {
    commanderRows.push(commanderRow(input.originalCommander, "removed", 1, 0));
  } else if (commanderChange === "added" && input.importedCommander) {
    commanderRows.push(commanderRow(input.importedCommander, "added", 0, 1));
  } else if (commanderChange === "changed" && input.originalCommander && input.importedCommander) {
    commanderRows.push(
      commanderRow(input.originalCommander, "removed", 1, 0),
      commanderRow(input.importedCommander, "added", 0, 1),
    );
  }

  const rows = [...commanderRows, ...cardRows];
  const changes = rows.filter((row) => row.kind !== "unchanged");
  return {
    rows,
    changes,
    summary: {
      added: changes.filter((row) => row.kind === "added").length,
      removed: changes.filter((row) => row.kind === "removed").length,
      quantity: changes.filter((row) => row.kind === "quantity").length,
      unchanged: cardRows.filter((row) => row.kind === "unchanged").length,
    },
    commanderChange,
  };
}
