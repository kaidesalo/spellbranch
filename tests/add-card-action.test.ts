import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { RATE_LIMITED_MESSAGE, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

// addCardToDeckAction: the client sends only a Scryfall id (and a quantity);
// the server fetches the card from Scryfall and stores Scryfall's data,
// including the color identity the deck-colors rule checks. Same pattern as
// setCommanderAction (PR #9/#10): rate limited and permission-checked before
// any lookup.

const ME = "a0000000-0000-4000-8000-000000000001";
const DECK = "d0000000-0000-4000-8000-000000000001";
const CARD_ID = "11111111-2222-4333-8444-555555555555";

const addCard = vi.fn(async () => undefined);
const getDeckPermissions = vi.fn(async () => ({ canEdit: true, canFork: true, canComment: true }));
let me = ME;
let requestHeaders = new Headers();
let scryfall: (id: string) => Promise<ScryfallCard | null>;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: me, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return { getRepository: () => ({ addCard, getDeckPermissions }), userMessage: errors.userMessage, DataError: errors.DataError };
});
vi.mock("@/lib/scryfall/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/scryfall/client")>()),
  getScryfallCard: vi.fn((id: string) => scryfall(id)),
}));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

const { addCardToDeckAction } = await import("@/lib/actions/decks");
const { getScryfallCard, ScryfallLookupError } = await import("@/lib/scryfall/client");
const { DeckColorError } = await import("@/lib/data/errors");

const bolt = (over: Partial<ScryfallCard> = {}): ScryfallCard => ({
  id: CARD_ID,
  name: "Lightning Bolt",
  mana_cost: "{R}",
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  image_uris: { normal: "https://cards.scryfall.io/normal/bolt.jpg" },
  ...over,
});

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  requestHeaders = new Headers({ "x-real-ip": "203.0.113.9" });
  me = ME;
  addCard.mockReset().mockResolvedValue(undefined);
  getDeckPermissions.mockReset().mockResolvedValue({ canEdit: true, canFork: true, canComment: true });
  vi.mocked(getScryfallCard).mockClear();
  scryfall = async () => bolt();
});

describe("addCardToDeckAction", () => {
  it("stores Scryfall's card, not the client's, including the color identity", async () => {
    const forged = {
      scryfallId: CARD_ID,
      quantity: 2,
      cardName: "Totally Colorless",
      colors: [],
      colorIdentity: [],
      color_identity: [],
      typeLine: "Artifact",
    };
    expect(await addCardToDeckAction(DECK, forged)).toEqual({ success: true });
    expect(getScryfallCard).toHaveBeenCalledWith(CARD_ID);
    expect(addCard).toHaveBeenCalledWith(ME, DECK, {
      scryfallId: CARD_ID,
      cardName: "Lightning Bolt",
      imageUri: "https://cards.scryfall.io/normal/bolt.jpg",
      manaCost: "{R}",
      typeLine: "Instant",
      colors: ["R"],
      colorIdentity: ["R"],
      oracleText: "Lightning Bolt deals 3 damage to any target.",
      quantity: 2,
    });
  });

  it("uses the identity, not the card colors (and keeps WUBRG order)", async () => {
    scryfall = async () => bolt({ name: "Kitchen Finks", colors: ["W", "G"], color_identity: ["G", "W", "W"] });
    await addCardToDeckAction(DECK, { scryfallId: CARD_ID });
    expect(addCard.mock.calls[0]).toBeDefined();
    const card = (addCard.mock.calls[0] as unknown as [string, string, { colorIdentity: string[]; quantity: number }])[2];
    expect(card.colorIdentity).toEqual(["W", "G"]);
    expect(card.quantity).toBe(1);
  });

  it("returns an off-color refusal from the repository as the message", async () => {
    addCard.mockRejectedValueOnce(
      new DeckColorError("Can't add Lightning Bolt: Red is outside this deck's colors (Dimir)."),
    );
    expect(await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).toEqual({
      error: "Can't add Lightning Bolt: Red is outside this deck's colors (Dimir).",
    });
  });

  it("checks the caller can edit the deck before any lookup", async () => {
    getDeckPermissions.mockResolvedValueOnce({ canEdit: false, canFork: true, canComment: true });
    expect(await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).toEqual({ error: "You cannot edit this deck" });
    expect(getScryfallCard).not.toHaveBeenCalled();
    expect(addCard).not.toHaveBeenCalled();
  });

  it("reports missing cards, Scryfall failures and oversize data cleanly", async () => {
    scryfall = async () => null;
    expect(await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).toEqual({ error: "Card not found" });
    scryfall = async () => { throw new ScryfallLookupError("timeout", "timed out"); };
    expect(await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).toEqual({
      error: "Scryfall took too long to answer. Try again in a moment.",
    });
    scryfall = async () => { throw new Error("anything"); };
    expect(await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).toEqual({ error: "Could not reach Scryfall" });
    scryfall = async () => bolt({ oracle_text: "o".repeat(5000) });
    expect(await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).toEqual({ error: expect.stringContaining("can't be added") });
    expect(addCard).not.toHaveBeenCalled();
  });

  it("limits lookups to 200 per user per 10 minutes, before any other work", async () => {
    for (let i = 0; i < 200; i++) expect((await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).success).toBe(true);
    vi.mocked(getScryfallCard).mockClear();
    getDeckPermissions.mockClear();
    requestHeaders = new Headers({ "x-real-ip": "198.51.100.77" });
    expect(await addCardToDeckAction(DECK, { scryfallId: CARD_ID })).toEqual({ error: RATE_LIMITED_MESSAGE, retryAfterSec: 600 });
    expect(getDeckPermissions).not.toHaveBeenCalled();
    expect(getScryfallCard).not.toHaveBeenCalled();
  });
});
