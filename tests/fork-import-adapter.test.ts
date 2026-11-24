import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import type { CardInput } from "@/lib/data/types";
import type { DeckCommander } from "@/lib/types";
import { FORK_IMPORT_DENIED, FORK_IMPORT_NOT_A_FORK } from "@/lib/fork-import";

// Local adapter: replaceForkList writes only an owned fork, and leaves the
// original deck's cards alone.

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

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const T = "2026-11-11T00:00:00.000Z";
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

const ATRAXA = "11111111-2222-4333-8444-555555555555";
const SOL = "22222222-3333-4444-8555-666666666666";
const FOREST = "33333333-4444-4555-8666-777777777777";
const BOLT = "44444444-5555-4666-8777-888888888888";
const SIGNET = "55555555-6666-4777-8888-999999999999";

const commander: DeckCommander = {
  scryfallId: ATRAXA,
  cardName: "Atraxa, Praetors' Voice",
  typeLine: "Legendary Creature — Phyrexian Angel Horror",
  manaCost: "{G}{W}{U}{B}",
  imageUri: null,
  artUri: null,
  colorIdentity: ["W", "U", "B", "G"],
};

function input(name: string, id: string, quantity: number, identity: string[] = [], board?: "main" | "side"): CardInput {
  return {
    scryfallId: id,
    cardName: name,
    imageUri: null,
    manaCost: "{1}",
    typeLine: "Card",
    colors: identity,
    colorIdentity: identity,
    oracleText: null,
    quantity,
    board,
  };
}

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

async function seedFork() {
  const originalId = await repo.createDeck(ALICE, {
    name: "Atraxa Tokens",
    format: "commander",
    notes: "",
    visibility: "private",
    allowForks: true,
    colors: ["W", "U", "B", "G"],
  });
  await repo.setCommander(ALICE, originalId, commander);
  await repo.addCard(ALICE, originalId, input("Sol Ring", SOL, 1));
  await repo.addCard(ALICE, originalId, input("Forest", FOREST, 10, ["G"]));
  await repo.addCard(ALICE, originalId, input("Lightning Bolt", BOLT, 1, ["R"], "side"));
  const forkId = await repo.forkDeck(ALICE, originalId, "Atraxa Tokens (branch)");
  return { originalId, forkId };
}

describe("replaceForkList", () => {
  it("replaces the fork and leaves the original deck unchanged", async () => {
    const { originalId, forkId } = await seedFork();
    await repo.replaceForkList(ALICE, forkId, {
      cards: [
        input("Sol Ring", SOL, 1),
        input("Forest", FOREST, 8, ["G"]),
        input("Arcane Signet", SIGNET, 1),
      ],
      commander,
      colors: ["W", "U", "B", "G"],
    });

    const original = await repo.getDeck(ALICE, originalId);
    const fork = await repo.getDeck(ALICE, forkId);
    const listed = (cards: { cardName: string; quantity: number; board?: string }[] | undefined) =>
      (cards ?? [])
        .map((card) => [card.cardName, card.quantity, card.board ?? "main"])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    expect(listed(original?.cards)).toEqual([
      ["Forest", 10, "main"],
      ["Lightning Bolt", 1, "side"],
      ["Sol Ring", 1, "main"],
    ]);
    expect(original?.commander?.cardName).toBe("Atraxa, Praetors' Voice");
    expect(listed(fork?.cards)).toEqual([
      ["Arcane Signet", 1, "main"],
      ["Forest", 8, "main"],
      ["Sol Ring", 1, "main"],
    ]);
    expect(fork?.commander?.cardName).toBe("Atraxa, Praetors' Voice");
    expect(fork?.colors).toEqual(["W", "U", "B", "G"]);
  });

  it("rejects a non-owner, a deck that is not a fork, and a copy", async () => {
    const { originalId, forkId } = await seedFork();
    const before = structuredClone(db);
    const replacement = {
      cards: [input("Sol Ring", SOL, 4)],
      commander,
      colors: ["W", "U", "B", "G"],
    };

    await expect(repo.replaceForkList(BOB, forkId, replacement)).rejects.toThrow(FORK_IMPORT_DENIED);
    await expect(repo.replaceForkList(ALICE, originalId, replacement)).rejects.toThrow(FORK_IMPORT_NOT_A_FORK);

    const copyId = await repo.copyDeck(ALICE, originalId, "Atraxa copy");
    await expect(repo.replaceForkList(ALICE, copyId, replacement)).rejects.toThrow(FORK_IMPORT_NOT_A_FORK);

    const fork = await repo.getDeck(ALICE, forkId);
    expect(fork?.cards?.map((card) => [card.cardName, card.quantity])).toEqual(
      before.deckCards
        .filter((card) => card.deckId === forkId)
        .map((card) => [card.cardName, card.quantity]),
    );
  });
});
