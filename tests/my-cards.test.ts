import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import { browseScope, collectionTotals, myCardsSection } from "@/lib/collection";

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
const CAROL = "a0000000-0000-4000-8000-000000000003";
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

const bolt = {
  scryfallId: "22222222-2222-4222-8222-222222222222",
  cardName: "Lightning Bolt",
  imageUri: null,
  manaCost: "{R}",
  typeLine: "Instant",
  quantity: 4,
  finish: "nonfoil" as const,
  condition: "NM" as const,
  forTrade: true,
};

beforeEach(() => {
  db = {
    users: [user(ALICE, "alice"), user(BOB, "bob"), user(CAROL, "carol")],
    friendships: [],
    favorites: [],
    decks: [],
    deckCards: [],
    comments: [],
    sessions: {},
  };
});

describe("my cards sections", () => {
  it("reads the section and browse scope from the page query", () => {
    expect(myCardsSection(undefined)).toBe("decks");
    expect(myCardsSection("branches")).toBe("branches");
    expect(myCardsSection("collection")).toBe("collection");
    expect(myCardsSection("public")).toBe("decks");
    expect(browseScope("public")).toBe("public");
    expect(browseScope("on-mine")).toBe("on-mine");
    expect(browseScope("nope")).toBe("friends");
  });

  it("keeps copies with decks and forks with branches", async () => {
    const original = await repo.createDeck(ALICE, {
      name: "Izzet",
      format: "modern",
      notes: "",
      visibility: "public",
      allowForks: true,
      colors: ["U", "R"],
    });
    const copyId = await repo.copyDeck(BOB, original);
    const forkId = await repo.forkDeck(BOB, original);
    const mine = await repo.listDecks(BOB, "mine");
    const branches = await repo.listMyBranches(BOB);
    expect(mine.map((deck) => deck.id)).toEqual([copyId]);
    expect(mine[0]?.forkedFromId).toBeNull();
    expect(branches.map((deck) => deck.id)).toEqual([forkId]);
    expect(branches[0]?.forkedFromId).toBe(original);
  });

  it("counts copies and for-trade piles separately", () => {
    expect(
      collectionTotals([
        { quantity: 4, forTrade: true },
        { quantity: 2, forTrade: false },
      ]),
    ).toEqual({ copies: 6, unique: 2, forTrade: 4 });
  });
});

describe("collection visibility", () => {
  it("hides a private collection, and shows only for-trade piles when shared", async () => {
    await repo.addCollectionCard(ALICE, bolt);
    await repo.addCollectionCard(ALICE, { ...bolt, scryfallId: "33333333-3333-4333-8333-333333333333", cardName: "Opt", forTrade: false, quantity: 2 });
    expect((await repo.listMyCollection(ALICE)).map((card) => card.cardName).sort()).toEqual([
      "Lightning Bolt",
      "Opt",
    ]);
    expect(await repo.listTradeCollection(BOB, ALICE)).toEqual([]);
    expect(await repo.listTradeCollection(null, ALICE)).toEqual([]);

    await repo.setCollectionVisibility(ALICE, "public");
    expect((await repo.listTradeCollection(null, ALICE)).map((card) => card.cardName)).toEqual(["Lightning Bolt"]);
    expect((await repo.listTradeCollection(BOB, ALICE)).every((card) => card.forTrade)).toBe(true);

    await repo.setCollectionVisibility(ALICE, "friends");
    db.friendships = [
      {
        id: "f1",
        requesterId: ALICE,
        addresseeId: BOB,
        status: "accepted",
        createdAt: T,
      },
    ];
    expect((await repo.listTradeCollection(BOB, ALICE)).map((card) => card.cardName)).toEqual(["Lightning Bolt"]);
    expect(await repo.listTradeCollection(CAROL, ALICE)).toEqual([]);

    const owned = (await repo.listMyCollection(ALICE)).find((card) => card.cardName === "Lightning Bolt")!;
    await expect(repo.updateCollectionCard(BOB, owned.id, { quantity: 1, finish: "foil", condition: null, forTrade: false })).rejects.toBeInstanceOf(DataError);
    await repo.addCollectionCard(ALICE, { ...bolt, finish: "foil", quantity: 1, forTrade: false });
    const piles = await repo.listMyCollection(ALICE);
    expect(piles.filter((card) => card.cardName === "Lightning Bolt").map((card) => card.finish).sort()).toEqual([
      "foil",
      "nonfoil",
    ]);
  });
});
