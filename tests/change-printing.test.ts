import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import { offeredFinishes, sameCardOracle } from "@/lib/printing";

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
const { DataError } = await import("@/lib/data/errors");

const T = "2026-11-11T00:00:00.000Z";
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const user = (id: string, username: string): LocalUser => ({
  id,
  username,
  displayName: username,
  email: `${username}@example.test`,
  bio: "",
  avatarUrl: null,
  passwordHash: "salt:hash",
  createdAt: T,
});

const OLD = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const printing = {
  scryfallId: NEXT,
  cardName: "Lightning Bolt",
  imageUri: "https://cards.scryfall.io/normal/front/a/b/new.jpg",
  manaCost: "{R}",
  typeLine: "Instant",
  colors: ["R"],
  colorIdentity: ["R"],
  oracleText: "Lightning Bolt deals 3 damage to any target.",
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

describe("printing identity", () => {
  it("matches only when both oracle ids are present and equal", () => {
    expect(sameCardOracle("abc", "abc")).toBe(true);
    expect(sameCardOracle("abc", "def")).toBe(false);
    expect(sameCardOracle(undefined, "abc")).toBe(false);
    expect(sameCardOracle("abc", null)).toBe(false);
  });

  it("keeps only finishes a collection can store", () => {
    expect(offeredFinishes(["foil", "nonfoil", "glossy", "etched", "foil"])).toEqual([
      "foil",
      "nonfoil",
      "etched",
    ]);
    expect(offeredFinishes(undefined)).toEqual([]);
  });
});

describe("deck printing swaps", () => {
  it("changes the printing and keeps quantity, board, and category", async () => {
    const deckId = await repo.createDeck(ALICE, {
      name: "Burn",
      format: "modern",
      notes: "",
      visibility: "public",
      allowForks: true,
      colors: ["R"],
    });
    await repo.addCard(ALICE, deckId, {
      scryfallId: OLD,
      cardName: "Lightning Bolt",
      imageUri: null,
      manaCost: "{R}",
      typeLine: "Instant",
      colors: ["R"],
      colorIdentity: ["R"],
      oracleText: null,
      quantity: 3,
      board: "side",
    });
    const categoryId = await repo.createCategory(ALICE, deckId, "Burn");
    let card = (await repo.getDeck(ALICE, deckId))!.cards!.find((row) => row.cardName === "Lightning Bolt")!;
    await repo.moveCardToCategory(ALICE, deckId, card.id, categoryId);
    await repo.changeDeckPrinting(ALICE, deckId, card.id, printing);
    card = (await repo.getDeck(ALICE, deckId))!.cards![0]!;
    expect(card).toMatchObject({
      scryfallId: NEXT,
      quantity: 3,
      board: "side",
      categoryId,
      imageUri: printing.imageUri,
    });
    const forkId = await repo.forkDeck(BOB, deckId);
    expect((await repo.getDeck(BOB, forkId))!.cards![0]).toMatchObject({ scryfallId: NEXT, board: "side" });
  });

  it("merges into the row that already has that printing on the same board", async () => {
    const deckId = await repo.createDeck(ALICE, {
      name: "Burn",
      format: "modern",
      notes: "",
      visibility: "private",
      allowForks: false,
      colors: ["R"],
    });
    await repo.addCard(ALICE, deckId, {
      scryfallId: OLD,
      cardName: "Lightning Bolt",
      imageUri: null,
      manaCost: "{R}",
      typeLine: "Instant",
      colors: ["R"],
      colorIdentity: ["R"],
      oracleText: null,
      quantity: 2,
    });
    await repo.addCard(ALICE, deckId, {
      ...printing,
      quantity: 1,
      oracleText: printing.oracleText,
    });
    const rows = (await repo.getDeck(ALICE, deckId))!.cards!;
    const source = rows.find((row) => row.scryfallId === OLD)!;
    await repo.changeDeckPrinting(ALICE, deckId, source.id, printing);
    const left = (await repo.getDeck(ALICE, deckId))!.cards!;
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ scryfallId: NEXT, quantity: 3, board: "main" });
  });

  it("refuses a swap from someone who does not own the deck", async () => {
    const deckId = await repo.createDeck(ALICE, {
      name: "Burn",
      format: "modern",
      notes: "",
      visibility: "public",
      allowForks: true,
      colors: ["R"],
    });
    await repo.addCard(ALICE, deckId, {
      scryfallId: OLD,
      cardName: "Lightning Bolt",
      imageUri: null,
      manaCost: "{R}",
      typeLine: "Instant",
      colors: ["R"],
      colorIdentity: ["R"],
      oracleText: null,
      quantity: 1,
    });
    const card = (await repo.getDeck(ALICE, deckId))!.cards![0]!;
    await expect(repo.changeDeckPrinting(BOB, deckId, card.id, printing)).rejects.toBeInstanceOf(DataError);
    expect((await repo.getDeck(ALICE, deckId))!.cards![0]!.scryfallId).toBe(OLD);
  });
});

describe("collection printing swaps", () => {
  it("keeps quantity and for-trade, and merges when that finish already exists", async () => {
    await repo.addCollectionCard(ALICE, {
      scryfallId: OLD,
      cardName: "Lightning Bolt",
      imageUri: null,
      manaCost: "{R}",
      typeLine: "Instant",
      quantity: 4,
      finish: "nonfoil",
      condition: "NM",
      forTrade: true,
    });
    await repo.addCollectionCard(ALICE, {
      scryfallId: NEXT,
      cardName: "Lightning Bolt",
      imageUri: null,
      manaCost: "{R}",
      typeLine: "Instant",
      quantity: 1,
      finish: "foil",
      condition: null,
      forTrade: false,
    });
    const source = (await repo.listMyCollection(ALICE)).find((card) => card.scryfallId === OLD)!;
    await repo.changeCollectionPrinting(ALICE, source.id, printing, "foil");
    const left = await repo.listMyCollection(ALICE);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ scryfallId: NEXT, finish: "foil", quantity: 5, forTrade: true });
    await expect(
      repo.changeCollectionPrinting(BOB, left[0]!.id, printing, "nonfoil"),
    ).rejects.toBeInstanceOf(DataError);
  });
});
