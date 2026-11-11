import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import { COLLECTION_CAP_MESSAGE, COLLECTION_MAX_ROWS } from "@/lib/collection";

let db: DataStore;
vi.mock("@/lib/data/store", () => ({
  readStore: async () => structuredClone(db),
  updateStore: async <T>(fn: (store: DataStore) => T | Promise<T>) => {
    const copy = structuredClone(db);
    const result = await fn(copy);
    db = copy;
    return result;
  },
}));

const { localRepository: repo } = await import("@/lib/data/local");
const { DataError } = await import("@/lib/data/errors");

const ALICE = "a0000000-0000-4000-8000-000000000001";
const T = "2026-11-11T00:00:00.000Z";

const user = (id: string): LocalUser => ({
  id,
  username: "alice",
  displayName: "Alice",
  email: "alice@example.test",
  bio: "",
  avatarUrl: null,
  passwordHash: "x:y",
  createdAt: T,
});

function card(n: number) {
  const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  return {
    id,
    userId: ALICE,
    scryfallId: id,
    cardName: "Card",
    imageUri: null,
    manaCost: null,
    typeLine: "Instant",
    quantity: 1,
    finish: "nonfoil" as const,
    condition: null,
    forTrade: false,
    createdAt: T,
    updatedAt: T,
  };
}

beforeEach(() => {
  db = {
    users: [user(ALICE)],
    friendships: [],
    favorites: [],
    comments: [],
    sessions: {},
    decks: [],
    deckCards: [],
    collectionCards: Array.from({ length: COLLECTION_MAX_ROWS }, (_, i) => card(i + 1)),
  };
});

describe("collection row cap", () => {
  it("matches migration 016", () => {
    const sql = readFileSync(path.join(path.resolve(__dirname, ".."), "supabase/migrations/016_p3_cleanup.sql"), "utf8");
    expect(sql).toMatch(/^begin;/m);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain(`n >= ${COLLECTION_MAX_ROWS}`);
    expect(sql).toContain(COLLECTION_CAP_MESSAGE);
    expect(COLLECTION_MAX_ROWS).toBe(5000);
  });

  it("refuses a new printing at the cap and still updates an existing pile", async () => {
    const fresh = "99999999-9999-4999-8999-999999999999";
    await expect(
      repo.addCollectionCard(ALICE, {
        scryfallId: fresh,
        cardName: "One more",
        imageUri: null,
        manaCost: null,
        typeLine: "Instant",
        quantity: 1,
        finish: "nonfoil",
        condition: null,
        forTrade: false,
      }),
    ).rejects.toEqual(new DataError(COLLECTION_CAP_MESSAGE));
    expect(db.collectionCards).toHaveLength(COLLECTION_MAX_ROWS);

    await repo.addCollectionCard(ALICE, {
      scryfallId: card(1).scryfallId,
      cardName: "Card",
      imageUri: null,
      manaCost: null,
      typeLine: "Instant",
      quantity: 2,
      finish: "nonfoil",
      condition: null,
      forTrade: true,
    });
    expect(db.collectionCards).toHaveLength(COLLECTION_MAX_ROWS);
    expect(db.collectionCards?.find((row) => row.scryfallId === card(1).scryfallId)?.quantity).toBe(3);
  });
});
