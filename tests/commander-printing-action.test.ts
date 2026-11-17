import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckCommander } from "@/lib/types";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

// changeCommanderPrintingAction: owner may swap the commander's printing
// when the new card shares the current commander's oracle id. The write
// goes through setCommander, so the card stays the commander.

const ME = "a0000000-0000-4000-8000-000000000001";
const DECK = "d0000000-0000-4000-8000-000000000001";
const CURRENT = "11111111-2222-4333-8444-555555555555";
const NEXT = "22222222-3333-4444-8555-666666666666";
const ORACLE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const setCommander = vi.fn<(userId: string, deckId: string, commander: DeckCommander | null) => Promise<void>>(
  async () => undefined,
);
const assertCanSetCommander = vi.fn(async () => undefined);
const getDeckPermissions = vi.fn(async () => ({
  canEdit: true,
  canFork: false,
  canCopy: false,
  canComment: true,
}));
const getDeck = vi.fn<() => Promise<{ commander: DeckCommander | null } | null>>(async () => ({
  commander: stored(),
}));

let scryfall: (id: string) => Promise<ScryfallCard | null>;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: ME, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return {
    getRepository: () => ({ setCommander, assertCanSetCommander, getDeckPermissions, getDeck }),
    userMessage: errors.userMessage,
    DataError: errors.DataError,
  };
});
vi.mock("@/lib/scryfall/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/scryfall/client")>()),
  getScryfallCard: vi.fn((id: string) => scryfall(id)),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

const { changeCommanderPrintingAction } = await import("@/lib/actions/decks");
const { getScryfallCard } = await import("@/lib/scryfall/client");

function stored(): DeckCommander {
  return {
    scryfallId: CURRENT,
    cardName: "Test Legend",
    typeLine: "Legendary Creature — Elf",
    manaCost: "{2}{G}",
    imageUri: "https://cards.scryfall.io/normal/old.jpg",
    artUri: "https://cards.scryfall.io/art_crop/old.jpg",
    colorIdentity: ["G"],
  };
}

function legend(id: string, oracle: string, image = "old"): ScryfallCard {
  return {
    id,
    oracle_id: oracle,
    name: "Test Legend",
    mana_cost: "{2}{G}",
    type_line: "Legendary Creature — Elf",
    color_identity: ["G"],
    image_uris: {
      normal: `https://cards.scryfall.io/normal/${image}.jpg`,
      art_crop: `https://cards.scryfall.io/art_crop/${image}.jpg`,
    },
  };
}

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  assertCanSetCommander.mockReset().mockResolvedValue(undefined);
  getDeckPermissions.mockReset().mockResolvedValue({
    canEdit: true,
    canFork: false,
    canCopy: false,
    canComment: true,
  });
  getDeck.mockReset().mockResolvedValue({ commander: stored() });
  setCommander.mockClear();
  vi.mocked(getScryfallCard).mockClear();
  scryfall = async (id: string) => legend(id === NEXT ? NEXT : CURRENT, ORACLE, id === NEXT ? "next" : "old");
});

describe("changeCommanderPrintingAction", () => {
  it("lets the owner save a printing of the same commander", async () => {
    expect(await changeCommanderPrintingAction(DECK, NEXT)).toEqual({ success: true });
    expect(getScryfallCard).toHaveBeenCalledWith(CURRENT);
    expect(getScryfallCard).toHaveBeenCalledWith(NEXT);
    expect(setCommander).toHaveBeenCalledWith(ME, DECK, {
      scryfallId: NEXT,
      cardName: "Test Legend",
      typeLine: "Legendary Creature — Elf",
      manaCost: "{2}{G}",
      imageUri: "https://cards.scryfall.io/normal/next.jpg",
      artUri: "https://cards.scryfall.io/art_crop/next.jpg",
      colorIdentity: ["G"],
    });
  });

  it("rejects someone who cannot edit the deck before any lookup", async () => {
    getDeckPermissions.mockResolvedValue({
      canEdit: false,
      canFork: false,
      canCopy: false,
      canComment: true,
    });
    expect(await changeCommanderPrintingAction(DECK, NEXT)).toEqual({ error: "You cannot edit this deck" });
    expect(getScryfallCard).not.toHaveBeenCalled();
    expect(setCommander).not.toHaveBeenCalled();
  });

  it("rejects a printing whose oracle id does not match the commander", async () => {
    scryfall = async (id: string) => legend(id, id === NEXT ? OTHER : ORACLE, "next");
    expect(await changeCommanderPrintingAction(DECK, NEXT)).toEqual({
      error: "That printing is a different card.",
    });
    expect(setCommander).not.toHaveBeenCalled();
  });

  it("keeps the card as the commander", async () => {
    expect(await changeCommanderPrintingAction(DECK, NEXT)).toEqual({ success: true });
    const saved = setCommander.mock.calls[0]?.[2] ?? null;
    expect(saved).not.toBeNull();
    expect(saved?.cardName).toBe("Test Legend");
    expect(saved?.typeLine).toContain("Legendary");
    expect(saved?.typeLine).toContain("Creature");
    expect(saved?.scryfallId).toBe(NEXT);
    expect(setCommander).not.toHaveBeenCalledWith(ME, DECK, null);
  });
});
