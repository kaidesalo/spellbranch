import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataError } from "@/lib/data/errors";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

const updateDeck = vi.fn(async () => {
  throw new DataError("You cannot edit this deck");
});
const deleteDeck = vi.fn(async () => {
  throw new DataError("You cannot delete this deck");
});
const addCard = vi.fn(async () => undefined);
const getDeckPermissions = vi.fn(async () => ({
  canEdit: false,
  canFork: true,
  canCopy: true,
  canComment: true,
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: "me", email: "me@example.test", username: "me", displayName: "Me" }),
}));
vi.mock("@/lib/data", () => ({
  getRepository: () => ({ updateDeck, deleteDeck, addCard, getDeckPermissions }),
  userMessage: (err: unknown, fallback: string) => (err instanceof DataError ? err.message : fallback),
  DataError,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { updateDeckMetaAction, deleteDeckAction, addCardToDeckAction } = await import("@/lib/actions/decks");

const DECK = "d0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  updateDeck.mockClear();
  deleteDeck.mockClear();
  addCard.mockClear();
  getDeckPermissions.mockClear();
});

describe("precon server actions", () => {
  it("does not rename, delete, or add a card when the deck is read-only", async () => {
    const form = new FormData();
    form.set("name", "Renamed");
    form.set("format", "commander");
    form.set("visibility", "public");
    form.set("allowForks", "on");
    expect(await updateDeckMetaAction(DECK, form)).toEqual({ error: "You cannot edit this deck" });
    expect(updateDeck).toHaveBeenCalled();
    expect(await deleteDeckAction(DECK)).toEqual({ error: "You cannot delete this deck" });
    expect(deleteDeck).toHaveBeenCalled();
    expect(await addCardToDeckAction(DECK, { scryfallId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1 })).toEqual({
      error: "You cannot edit this deck",
    });
    expect(addCard).not.toHaveBeenCalled();
  });
});
