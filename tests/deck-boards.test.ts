import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import { assertColorsFitDeck } from "@/lib/data/deck-color-rules";
import { compareDeckLists } from "@/lib/deck-diff";
import { mainboardQuantity } from "@/lib/deck-boards";
import { exportDecklist } from "@/lib/decklist/export";
import { parseDecklist } from "@/lib/decklist/parse";

let db: DataStore;
vi.mock("@/lib/data/store", () => ({
  readStore: async () => structuredClone(db),
  updateStore: async <T>(fn: (s: DataStore) => T | Promise<T>) => {
    const copy = structuredClone(db);
    const result = await fn(copy);
    db = copy;
    return result;
  },
}));

const { localRepository: repo } = await import("@/lib/data/local");
const { DeckColorError } = await import("@/lib/data/errors");

const T = "2026-11-11T00:00:00.000Z";
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const user = (id: string, username: string): LocalUser => ({
  id,
  username,
  displayName: username.toUpperCase(),
  email: `${username}@example.test`,
  bio: "",
  avatarUrl: null,
  passwordHash: "salt:hash",
  createdAt: T,
});

const plains = {
  scryfallId: "11111111-1111-4111-8111-111111111111",
  cardName: "Plains",
  imageUri: null,
  manaCost: "",
  typeLine: "Basic Land — Plains",
  colors: [] as string[],
  colorIdentity: ["W"],
  oracleText: null,
  quantity: 1,
};
const bolt = {
  ...plains,
  scryfallId: "22222222-2222-4222-8222-222222222222",
  cardName: "Lightning Bolt",
  manaCost: "{R}",
  typeLine: "Instant",
  colors: ["R"],
  colorIdentity: ["R"],
};
const ponder = {
  ...plains,
  scryfallId: "33333333-3333-4333-8333-333333333333",
  cardName: "Ponder",
  manaCost: "{U}",
  typeLine: "Sorcery",
  colors: ["U"],
  colorIdentity: ["U"],
};

beforeEach(() => {
  db = {
    users: [user(ALICE, "alice"), user(BOB, "bob")],
    friendships: [],
    favorites: [],
    decks: [],
    deckCards: [],
    comments: [],
    sessions: {},
  };
});

async function whiteDeck() {
  return repo.createDeck(ALICE, {
    name: "White",
    format: "commander",
    notes: "",
    visibility: "public",
    allowForks: true,
    colors: ["W"],
  });
}

describe("board totals and color checks", () => {
  it("counts only the mainboard toward the deck total", () => {
    expect(
      mainboardQuantity([
        { quantity: 2, board: "main" },
        { quantity: 4, board: "side" },
        { quantity: 1, board: "maybe" },
        { quantity: 3 },
      ]),
    ).toBe(5);
  });

  it("ignores sideboard and maybeboard cards when the deck colors change", () => {
    expect(() =>
      assertColorsFitDeck(
        ["W"],
        [
          { cardName: "Plains", colors: [], colorIdentity: ["W"], board: "main" },
          { cardName: "Lightning Bolt", colors: ["R"], colorIdentity: ["R"], board: "side" },
          { cardName: "Ponder", colors: ["U"], colorIdentity: ["U"], board: "maybe" },
        ],
        null,
      ),
    ).not.toThrow();
    expect(() =>
      assertColorsFitDeck(
        ["W"],
        [{ cardName: "Lightning Bolt", colors: ["R"], colorIdentity: ["R"], board: "main" }],
        null,
      ),
    ).toThrow(DeckColorError);
  });

  it("keeps side and maybe out of the stored deck total and lets them be off-color", async () => {
    const id = await whiteDeck();
    await repo.addCard(ALICE, id, { ...plains, quantity: 2 });
    await repo.addCard(ALICE, id, { ...bolt, board: "side" });
    await repo.addCard(ALICE, id, { ...ponder, board: "maybe", quantity: 3 });
    await expect(repo.addCard(ALICE, id, bolt)).rejects.toBeInstanceOf(DeckColorError);

    const deck = await repo.getDeck(ALICE, id);
    expect(deck?.cardCount).toBe(2);
    expect(deck?.cards?.map((card) => [card.cardName, card.board, card.quantity])).toEqual([
      ["Plains", "main", 2],
      ["Lightning Bolt", "side", 1],
      ["Ponder", "maybe", 3],
    ]);

    const side = deck!.cards!.find((card) => card.cardName === "Lightning Bolt")!;
    await repo.setCardQuantity(ALICE, id, side.id, 4);
    expect((await repo.getDeck(ALICE, id))?.cardCount).toBe(2);
  });
});

describe("moving cards between boards", () => {
  it("moves a card, merges a printing that is already there, and keeps its category", async () => {
    const id = await whiteDeck();
    await repo.addCard(ALICE, id, { ...plains, quantity: 2 });
    await repo.addCard(ALICE, id, { ...plains, board: "side" });
    await repo.addCard(ALICE, id, { ...bolt, board: "side" });

    const before = (await repo.getDeck(ALICE, id))!;
    const sidePlains = before.cards!.find((card) => card.board === "side" && card.cardName === "Plains")!;
    await repo.moveCardToBoard(ALICE, id, sidePlains.id, "main");
    const merged = (await repo.getDeck(ALICE, id))!;
    expect(merged.cardCount).toBe(3);
    expect(merged.cards!.filter((card) => card.cardName === "Plains")).toEqual([
      expect.objectContaining({ board: "main", quantity: 3 }),
    ]);

    const boltRow = merged.cards!.find((card) => card.cardName === "Lightning Bolt")!;
    await expect(repo.moveCardToBoard(ALICE, id, boltRow.id, "main")).rejects.toBeInstanceOf(
      DeckColorError,
    );

    const categoryId = await repo.createCategory(ALICE, id, "Lands");
    const mainPlains = (await repo.getDeck(ALICE, id))!.cards!.find((card) => card.cardName === "Plains")!;
    await repo.moveCardToCategory(ALICE, id, mainPlains.id, categoryId);
    await repo.moveCardToBoard(ALICE, id, mainPlains.id, "maybe");
    const parked = (await repo.getDeck(ALICE, id))!.cards!.find((card) => card.cardName === "Plains")!;
    expect(parked).toMatchObject({ board: "maybe", categoryId, quantity: 3 });
    expect((await repo.getDeck(ALICE, id))?.cardCount).toBe(0);

    await repo.moveCardToBoard(ALICE, id, parked.id, "main");
    const back = (await repo.getDeck(ALICE, id))!.cards!.find((card) => card.cardName === "Plains")!;
    expect(back).toMatchObject({ board: "main", categoryId, quantity: 3 });
    expect((await repo.getDeck(ALICE, id))?.cardCount).toBe(3);
  });
});

describe("fork and copy keep each card's board", () => {
  it("copies main, side, and maybe onto the new deck", async () => {
    const id = await whiteDeck();
    await repo.addCard(ALICE, id, plains);
    await repo.addCard(ALICE, id, { ...bolt, board: "side" });
    await repo.addCard(ALICE, id, { ...ponder, board: "maybe" });

    const forkId = await repo.forkDeck(BOB, id);
    const copyId = await repo.copyDeck(BOB, id);
    for (const nextId of [forkId, copyId]) {
      const next = await repo.getDeck(BOB, nextId);
      expect(next?.cardCount).toBe(1);
      expect(next?.cards?.map((card) => [card.cardName, card.board]).sort()).toEqual([
        ["Lightning Bolt", "side"],
        ["Plains", "main"],
        ["Ponder", "maybe"],
      ]);
    }
    expect((await repo.getDeck(null, id))?.cardCount).toBe(1);
  });
});

describe("export and compare label boards", () => {
  it("leaves a mainboard-only list unchanged and appends the other boards", () => {
    const mainOnly = exportDecklist({
      commanderName: "Heliod, Sun-Crowned",
      cards: [{ cardName: "Plains", quantity: 10 }],
    });
    expect(mainOnly).toBe("1 Heliod, Sun-Crowned\n\n10 Plains\n");

    const text = exportDecklist({
      commanderName: null,
      cards: [
        { cardName: "Plains", quantity: 2, board: "main" },
        { cardName: "Lightning Bolt", quantity: 1, board: "side" },
        { cardName: "Ponder", quantity: 1, board: "maybe" },
      ],
    });
    expect(text).toBe("2 Plains\n\nSIDEBOARD\n1 Lightning Bolt\n\nMAYBEBOARD\n1 Ponder\n");
    const parsed = parseDecklist(text);
    expect(parsed.cards).toEqual([{ name: "Plains", quantity: 2 }]);
    expect(parsed.warnings.join(" ")).toMatch(/sideboard/i);
    expect(parsed.warnings.join(" ")).toMatch(/maybeboard/i);
  });

  it("treats the same printing on two boards as two rows", () => {
    const card = {
      scryfallId: "s1",
      cardName: "Sol Ring",
      imageUri: null,
      manaCost: "{1}",
      typeLine: "Artifact",
      quantity: 1,
    };
    const diffs = compareDeckLists(
      [{ ...card, board: "main" }],
      [
        { ...card, board: "main" },
        { ...card, board: "side" },
      ],
    );
    expect(diffs.filter((diff) => diff.kind !== "unchanged")).toEqual([
      expect.objectContaining({ scryfallId: "s1", board: "side", kind: "added", branchQty: 1 }),
    ]);
  });
});
