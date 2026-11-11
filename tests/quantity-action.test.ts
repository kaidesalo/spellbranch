import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";

// updateCardQuantityAction (used by -/+, trash and the typed quantity) run
// against the real local repository: ownership, bounds, the cap and 0.

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

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const DECK = "d0000000-0000-4000-8000-000000000001";
const OTHER_DECK = "d0000000-0000-4000-8000-000000000002";
const SWAMP = "c0000000-0000-4000-8000-000000000001";
const ISLAND = "c0000000-0000-4000-8000-000000000002";
const BOBS_CARD = "c0000000-0000-4000-8000-000000000003";

let me = ALICE;
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: me, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  const { localRepository } = await import("@/lib/data/local");
  return { getRepository: () => localRepository, userMessage: errors.userMessage, DataError: errors.DataError };
});
const revalidated: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => void revalidated.push(p) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

const { updateCardQuantityAction, removeCardFromDeckAction } = await import("@/lib/actions/decks");

const T = "2026-11-01T12:00:00.000Z";
const user = (id: string, username: string): LocalUser => ({
  id, username, displayName: username, email: `${username}@example.test`, bio: "", avatarUrl: null, passwordHash: "x:y", createdAt: T,
});
const deck = (id: string, ownerId: string, format: "commander" | "modern") => ({
  id, ownerId, name: "Deck", format, notes: "", visibility: "public" as const, allowForks: true,
  forkedFromId: null, preferredBranchId: null, commander: null, createdAt: T, updatedAt: T,
});
const card = (id: string, deckId: string, cardName: string, quantity: number) => ({
  id, deckId, scryfallId: `s-${id}`, cardName, imageUri: null, manaCost: null,
  typeLine: `Basic Land — ${cardName}`, colors: [], oracleText: null, quantity, createdAt: T,
});

const qty = (id: string) => db.deckCards.find((c) => c.id === id)?.quantity;

beforeEach(() => {
  me = ALICE;
  revalidated.length = 0;
  db = {
    users: [user(ALICE, "alice_u"), user(BOB, "bob_u")],
    friendships: [], favorites: [], comments: [], sessions: {},
    decks: [deck(DECK, ALICE, "commander"), deck(OTHER_DECK, BOB, "modern")] as DataStore["decks"],
    deckCards: [card(SWAMP, DECK, "Swamp", 1), card(ISLAND, DECK, "Island", 3), card(BOBS_CARD, OTHER_DECK, "Swamp", 4)],
  };
});

describe("updateCardQuantityAction", () => {
  it("sets the quantity for the deck owner and returns it", async () => {
    expect(await updateCardQuantityAction(DECK, SWAMP, 12)).toEqual({ success: true, quantity: 12 });
    expect(qty(SWAMP)).toBe(12);
    expect(revalidated).toEqual([`/decks/${DECK}`]);
  });

  it("caps a very large number at 99 on the server", async () => {
    for (const big of [100, 500, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(await updateCardQuantityAction(DECK, SWAMP, big)).toEqual({ success: true, quantity: 99 });
      expect(qty(SWAMP)).toBe(99);
    }
  });

  it("0 removes the card, exactly like the trash button", async () => {
    expect(await updateCardQuantityAction(DECK, SWAMP, 0)).toEqual({ success: true, quantity: 0 });
    expect(qty(SWAMP)).toBeUndefined();
    expect(qty(ISLAND)).toBe(3);
    expect(await removeCardFromDeckAction(DECK, ISLAND)).toEqual({ success: true, quantity: 0 });
    expect(db.deckCards.map((c) => c.id)).toEqual([BOBS_CARD]);
  });

  it("refuses negatives, decimals and non-numbers without touching the deck", async () => {
    const before = structuredClone(db);
    for (const bad of [-1, 1.5, Number.NaN, Infinity, -Infinity, "5", null, undefined, {}]) {
      expect(
        await updateCardQuantityAction(DECK, SWAMP, bad as number),
        String(bad),
      ).toEqual({ error: "Quantity must be between 0 and 99" });
    }
    expect(db).toEqual(before);
  });

  it("only the owner can change a quantity", async () => {
    me = BOB;
    const before = structuredClone(db);
    expect(await updateCardQuantityAction(DECK, SWAMP, 5)).toEqual({ error: "You cannot edit this deck" });
    expect(await updateCardQuantityAction(DECK, SWAMP, 0)).toEqual({ error: "You cannot edit this deck" });
    expect(db).toEqual(before);
  });

  it("can't reach a card in someone else's deck through your own deck", async () => {
    expect(await updateCardQuantityAction(DECK, BOBS_CARD, 7)).toEqual({ error: "Card not found in deck" });
    expect(qty(BOBS_CARD)).toBe(4);
    // ...and 0 on a card from another deck deletes nothing.
    await updateCardQuantityAction(DECK, BOBS_CARD, 0);
    expect(qty(BOBS_CARD)).toBe(4);
  });

  it("a Commander deck uses the same cap (no singleton rule exists yet)", async () => {
    // The format has no per-card limit in Spellbranch today: basics like
    // Swamp need more than one copy, and nothing enforces singleton for
    // other cards on add either. When a rule lands, this test should change.
    expect(await updateCardQuantityAction(DECK, SWAMP, 30)).toEqual({ success: true, quantity: 30 });
  });
});
