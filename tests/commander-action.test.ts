import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";

// setCommanderAction: the client sends only a Scryfall id; the server fetches
// the card itself and saves it only if it is a legendary creature.

const ME = "a0000000-0000-4000-8000-000000000001";
const DECK = "d0000000-0000-4000-8000-000000000001";
const CARD_ID = "11111111-2222-4333-8444-555555555555";

const setCommander = vi.fn(async () => undefined);
let scryfall: (id: string) => Promise<ScryfallCard | null>;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: ME, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return { getRepository: () => ({ setCommander }), userMessage: errors.userMessage, DataError: errors.DataError };
});
vi.mock("@/lib/scryfall/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/scryfall/client")>()),
  getScryfallCard: vi.fn((id: string) => scryfall(id)),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

const { setCommanderAction } = await import("@/lib/actions/decks");
const { getScryfallCard } = await import("@/lib/scryfall/client");
const { DataError, COMMANDER_MESSAGES } = await import("@/lib/data/errors");

const legend = (over: Partial<ScryfallCard> = {}): ScryfallCard => ({
  id: CARD_ID,
  name: "Test Legend",
  mana_cost: "{2}{G}",
  type_line: "Legendary Creature — Elf",
  color_identity: ["G"],
  image_uris: { normal: "https://cards.scryfall.io/normal/x.jpg", art_crop: "https://cards.scryfall.io/art_crop/x.jpg" },
  ...over,
});

beforeEach(() => {
  setCommander.mockClear();
  vi.mocked(getScryfallCard).mockClear();
  scryfall = async () => legend();
});

describe("setCommanderAction", () => {
  it("fetches the card on the server and saves the commander", async () => {
    expect(await setCommanderAction(DECK, CARD_ID)).toEqual({ success: true });
    expect(getScryfallCard).toHaveBeenCalledWith(CARD_ID);
    expect(setCommander).toHaveBeenCalledWith(ME, DECK, {
      scryfallId: CARD_ID,
      cardName: "Test Legend",
      typeLine: "Legendary Creature — Elf",
      manaCost: "{2}{G}",
      imageUri: "https://cards.scryfall.io/normal/x.jpg",
      artUri: "https://cards.scryfall.io/art_crop/x.jpg",
      colorIdentity: ["G"],
    });
  });

  it("clears without calling Scryfall", async () => {
    expect(await setCommanderAction(DECK, null)).toEqual({ success: true });
    expect(getScryfallCard).not.toHaveBeenCalled();
    expect(setCommander).toHaveBeenCalledWith(ME, DECK, null);
  });

  it("rejects a card that isn't a legendary creature, whatever the client claims", async () => {
    for (const type_line of ["Legendary Artifact", "Creature — Elf", "Legendary Planeswalker — Teferi"]) {
      scryfall = async () => legend({ type_line });
      expect(await setCommanderAction(DECK, CARD_ID)).toEqual({ error: COMMANDER_MESSAGES.notLegendaryCreature });
    }
    expect(setCommander).not.toHaveBeenCalled();
  });

  it("rejects bad ids before any lookup", async () => {
    const bad: unknown[] = [undefined, 42, {}, "", "not-a-uuid", `${CARD_ID}x`, "../cards/random", "x?q=1"];
    for (const b of bad) {
      expect(await setCommanderAction(b as string, CARD_ID)).toEqual({ error: expect.any(String) });
      expect(await setCommanderAction(DECK, b as string)).toEqual({ error: expect.any(String) });
    }
    expect(getScryfallCard).not.toHaveBeenCalled();
    expect(setCommander).not.toHaveBeenCalled();
  });

  it("reports a missing card and an unreachable Scryfall cleanly", async () => {
    scryfall = async () => null;
    expect(await setCommanderAction(DECK, CARD_ID)).toEqual({ error: "Card not found" });
    scryfall = async () => { throw new Error("Scryfall card lookup failed (503)"); };
    expect(await setCommanderAction(DECK, CARD_ID)).toEqual({ error: "Could not reach Scryfall" });
    expect(setCommander).not.toHaveBeenCalled();
  });

  it("passes repository refusals through as messages", async () => {
    setCommander.mockRejectedValueOnce(new DataError(COMMANDER_MESSAGES.notCommanderFormat));
    expect(await setCommanderAction(DECK, CARD_ID)).toEqual({ error: COMMANDER_MESSAGES.notCommanderFormat });
    setCommander.mockRejectedValueOnce(new Error("boom: internal detail"));
    const r = await setCommanderAction(DECK, CARD_ID);
    expect(r).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(r)).not.toContain("internal detail");
  });
});
