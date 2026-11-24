import { describe, expect, it } from "vitest";
import { diffImportAgainstOriginal } from "@/lib/fork-import-diff";

const SOL = "22222222-3333-4444-8555-666666666666";
const FOREST = "33333333-4444-4555-8666-777777777777";
const BOLT = "44444444-5555-4666-8777-888888888888";
const SIGNET = "55555555-6666-4777-8888-999999999999";
const DELVER = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const ATRAXA = "11111111-2222-4333-8444-555555555555";
const ISSHIN = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

function card(
  scryfallId: string,
  cardName: string,
  quantity: number,
  board?: "main" | "side" | "maybe",
  typeLine = "Card",
) {
  return { scryfallId, cardName, quantity, board, typeLine, manaCost: "{1}" };
}

describe("diffImportAgainstOriginal", () => {
  const original = {
    originalCards: [
      card(SOL, "Sol Ring", 1, "main", "Artifact"),
      card(FOREST, "Forest", 10, "main", "Basic Land — Forest"),
      card(BOLT, "Lightning Bolt", 1, "side", "Instant"),
    ],
    originalCommander: {
      scryfallId: ATRAXA,
      cardName: "Atraxa, Praetors' Voice",
      typeLine: "Legendary Creature — Phyrexian Angel Horror",
    },
  };

  it("reports added cards, removed cards, and quantity changes", () => {
    const diff = diffImportAgainstOriginal({
      ...original,
      importedCards: [
        card(SOL, "Sol Ring", 1, "main", "Artifact"),
        card(FOREST, "Forest", 8, "main", "Basic Land — Forest"),
        card(SIGNET, "Arcane Signet", 1, "main", "Artifact"),
      ],
      importedCommander: original.originalCommander,
    });

    expect(diff.summary).toEqual({ added: 1, removed: 1, quantity: 1, unchanged: 1 });
    expect(diff.changes).toEqual([
      expect.objectContaining({
        cardName: "Arcane Signet",
        kind: "added",
        board: "main",
        originalQty: 0,
        importQty: 1,
      }),
      expect.objectContaining({
        cardName: "Lightning Bolt",
        kind: "removed",
        board: "side",
        originalQty: 1,
        importQty: 0,
      }),
      expect.objectContaining({
        cardName: "Forest",
        kind: "quantity",
        board: "main",
        originalQty: 10,
        importQty: 8,
      }),
    ]);
    expect(diff.changes.some((row) => row.cardName === "Sol Ring")).toBe(false);
    expect(diff.commanderChange).toBe("same");
  });

  it("treats the same printing on two boards as added and removed, not a quantity change", () => {
    const diff = diffImportAgainstOriginal({
      originalCards: [card(SOL, "Sol Ring", 1, "main")],
      originalCommander: null,
      importedCards: [card(SOL, "Sol Ring", 1, "side")],
      importedCommander: null,
    });

    expect(diff.changes.map((row) => ({ board: row.board, kind: row.kind, name: row.cardName }))).toEqual([
      { board: "side", kind: "added", name: "Sol Ring" },
      { board: "main", kind: "removed", name: "Sol Ring" },
    ]);
    expect(diff.summary.quantity).toBe(0);
    expect(diff.commanderChange).toBe("none");
  });

  it("keeps a double-faced card as one row and shows the combined name", () => {
    const sameQty = diffImportAgainstOriginal({
      originalCards: [card(DELVER, "Delver of Secrets", 1, "main", "Creature — Human Wizard")],
      originalCommander: null,
      importedCards: [
        card(DELVER, "Delver of Secrets // Insectile Aberration", 1, "main", "Creature — Human Wizard // Creature — Insect"),
      ],
      importedCommander: null,
    });

    expect(sameQty.changes).toEqual([]);
    expect(sameQty.summary).toEqual({ added: 0, removed: 0, quantity: 0, unchanged: 1 });
    expect(sameQty.rows[0]).toEqual(
      expect.objectContaining({
        scryfallId: DELVER,
        cardName: "Delver of Secrets // Insectile Aberration",
        kind: "unchanged",
        originalQty: 1,
        importQty: 1,
      }),
    );

    const moreCopies = diffImportAgainstOriginal({
      originalCards: [card(DELVER, "Delver of Secrets // Insectile Aberration", 1)],
      originalCommander: null,
      importedCards: [card(DELVER, "Delver of Secrets", 3)],
      importedCommander: null,
    });
    expect(moreCopies.changes).toEqual([
      expect.objectContaining({
        scryfallId: DELVER,
        cardName: "Delver of Secrets // Insectile Aberration",
        kind: "quantity",
        originalQty: 1,
        importQty: 3,
        board: "main",
      }),
    ]);
  });

  it("labels a maybeboard quantity change on its own board", () => {
    const diff = diffImportAgainstOriginal({
      originalCards: [card(BOLT, "Lightning Bolt", 2, "maybe", "Instant")],
      originalCommander: null,
      importedCards: [card(BOLT, "Lightning Bolt", 1, "maybe", "Instant")],
      importedCommander: null,
    });
    expect(diff.changes).toEqual([
      expect.objectContaining({ board: "maybe", kind: "quantity", originalQty: 2, importQty: 1 }),
    ]);
  });

  it("reports a commander swap as a removal and an addition", () => {
    const diff = diffImportAgainstOriginal({
      originalCards: [card(SOL, "Sol Ring", 1)],
      originalCommander: { scryfallId: ATRAXA, cardName: "Atraxa, Praetors' Voice" },
      importedCards: [card(SOL, "Sol Ring", 1)],
      importedCommander: { scryfallId: ISSHIN, cardName: "Isshin, Two Heavens as One" },
    });
    expect(diff.commanderChange).toBe("changed");
    expect(diff.changes.filter((row) => row.board === "commander")).toEqual([
      expect.objectContaining({
        cardName: "Atraxa, Praetors' Voice",
        kind: "removed",
        originalQty: 1,
        importQty: 0,
      }),
      expect.objectContaining({
        cardName: "Isshin, Two Heavens as One",
        kind: "added",
        originalQty: 0,
        importQty: 1,
      }),
    ]);
    expect(diff.summary.added).toBe(1);
    expect(diff.summary.removed).toBe(1);
    expect(diff.summary.unchanged).toBe(1);
  });

  it("reports a commander that was cleared or newly set", () => {
    const cleared = diffImportAgainstOriginal({
      originalCards: [],
      originalCommander: { scryfallId: ATRAXA, cardName: "Atraxa, Praetors' Voice" },
      importedCards: [],
      importedCommander: null,
    });
    expect(cleared.commanderChange).toBe("removed");
    expect(cleared.changes).toEqual([
      expect.objectContaining({ board: "commander", kind: "removed", cardName: "Atraxa, Praetors' Voice" }),
    ]);

    const added = diffImportAgainstOriginal({
      originalCards: [],
      originalCommander: null,
      importedCards: [],
      importedCommander: { scryfallId: ATRAXA, cardName: "Atraxa, Praetors' Voice" },
    });
    expect(added.commanderChange).toBe("added");
    expect(added.changes[0]).toEqual(
      expect.objectContaining({ board: "commander", kind: "added", importQty: 1, originalQty: 0 }),
    );
  });
});
