import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { RATE_LIMITED_MESSAGE, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

// importDeckAction: a signed-in user pastes a list, Spellbranch creates a
// deck they own, and every stored card comes from Scryfall. Deck-site URLs
// are refused before any fetch.

const ME = "a0000000-0000-4000-8000-000000000001";
const DECK = "d0000000-0000-4000-8000-0000000000aa";
const ATRAXA = "11111111-2222-4333-8444-555555555555";
const SOL = "22222222-3333-4444-8555-666666666666";
const FOREST = "33333333-4444-4555-8666-777777777777";

const createDeck = vi.fn(async () => DECK);
const addCard = vi.fn(async () => undefined);
const setCommander = vi.fn(async () => undefined);
const deleteDeck = vi.fn(async () => undefined);
let requestHeaders = new Headers();

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: ME, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return {
    getRepository: () => ({ createDeck, addCard, setCommander, deleteDeck }),
    userMessage: errors.userMessage,
    DataError: errors.DataError,
  };
});
vi.mock("@/lib/scryfall/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/scryfall/client")>()),
  getScryfallCardsByName: vi.fn(async (names: string[]) =>
    names.flatMap((name) => {
      const card = CATALOG[name];
      return card ? [card] : [];
    }),
  ),
}));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const { importDeckAction } = await import("@/lib/actions/deck-import");
const { getScryfallCardsByName, ScryfallLookupError } = await import("@/lib/scryfall/client");

function scry(over: Partial<ScryfallCard> & Pick<ScryfallCard, "id" | "name" | "type_line">): ScryfallCard {
  return {
    mana_cost: "{1}",
    oracle_text: "Oracle.",
    colors: [],
    color_identity: [],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/x/card.jpg",
      art_crop: "https://cards.scryfall.io/art_crop/front/x/card.jpg",
    },
    ...over,
  };
}

const CATALOG: Record<string, ScryfallCard> = {
  "Atraxa, Praetors' Voice": scry({
    id: ATRAXA,
    name: "Atraxa, Praetors' Voice",
    mana_cost: "{G}{W}{U}{B}",
    type_line: "Legendary Creature — Phyrexian Angel Horror",
    colors: ["B", "G", "U", "W"],
    color_identity: ["B", "G", "U", "W"],
  }),
  "Sol Ring": scry({ id: SOL, name: "Sol Ring", type_line: "Artifact" }),
  Forest: scry({
    id: FOREST,
    name: "Forest",
    type_line: "Basic Land — Forest",
    colors: ["G"],
    color_identity: ["G"],
  }),
};

const MOXFIELD = `1 Atraxa, Praetors' Voice

1 Sol Ring
10 Forest
`;

function form(over: Record<string, string> = {}) {
  const data = new FormData();
  data.set("name", over.name ?? "From Moxfield");
  data.set("format", over.format ?? "commander");
  data.set("visibility", over.visibility ?? "private");
  if ((over.allowForks ?? "true") !== "false") data.set("allowForks", "true");
  data.set("list", over.list ?? MOXFIELD);
  return data;
}

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  requestHeaders = new Headers({ "x-real-ip": "203.0.113.9" });
  createDeck.mockClear();
  addCard.mockReset().mockResolvedValue(undefined);
  setCommander.mockReset().mockResolvedValue(undefined);
  deleteDeck.mockReset().mockResolvedValue(undefined);
  vi.mocked(getScryfallCardsByName).mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("deck import must not fetch on its own");
  }));
});

describe("importDeckAction", () => {
  it("creates an owned deck, with commander and basic lands resolved from Scryfall", async () => {
    await expect(importDeckAction(form())).rejects.toThrow(`NEXT_REDIRECT /decks/${DECK}`);
    expect(getScryfallCardsByName).toHaveBeenCalledWith([
      "Atraxa, Praetors' Voice",
      "Sol Ring",
      "Forest",
    ]);
    expect(createDeck).toHaveBeenCalledWith(ME, {
      name: "From Moxfield",
      format: "commander",
      notes: "",
      visibility: "private",
      allowForks: true,
      colors: ["W", "U", "B", "G"],
    });
    expect(addCard).toHaveBeenCalledTimes(2);
    expect(addCard).toHaveBeenCalledWith(ME, DECK, expect.objectContaining({
      cardName: "Sol Ring",
      quantity: 1,
      scryfallId: SOL,
      colorIdentity: [],
    }));
    expect(addCard).toHaveBeenCalledWith(ME, DECK, expect.objectContaining({
      cardName: "Forest",
      quantity: 10,
      scryfallId: FOREST,
      colorIdentity: ["G"],
      typeLine: "Basic Land — Forest",
    }));
    expect(setCommander).toHaveBeenCalledWith(ME, DECK, expect.objectContaining({
      cardName: "Atraxa, Praetors' Voice",
      scryfallId: ATRAXA,
      colorIdentity: ["W", "U", "B", "G"],
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("imports an Archidekt category list and reports the skipped maybeboard", async () => {
    const result = await importDeckAction(form({
      name: "From Archidekt",
      list: `//Commander
1 Atraxa, Praetors' Voice

//Lands
10 Forest
1 Command Tower

//Maybeboard
1 Cyclonic Rift
`,
    }));
    expect(result.id).toBe(DECK);
    expect(result.warnings?.join("\n")).toMatch(/Maybeboard/);
    expect(result.warnings?.join("\n")).toMatch(/Command Tower/);
    expect(result.commanderName).toBe("Atraxa, Praetors' Voice");
    expect(result.added).toBe(10);
    const lookedUp = vi.mocked(getScryfallCardsByName).mock.calls[0]?.[0] as string[];
    expect(lookedUp).not.toContain("Cyclonic Rift");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a Moxfield or Archidekt URL without calling Scryfall", async () => {
    const mox = await importDeckAction(form({
      list: "https://user:secret-token@www.moxfield.com/decks/CFeCQ5NOMESJOSSGLB8cPg",
    }));
    expect(mox.error).toMatch(/Plain Text/);
    expect(mox.error).not.toContain("secret-token");
    const arch = await importDeckAction(form({
      list: "https://archidekt.com/decks/19345263/yurikoninjas",
    }));
    expect(arch.error).toMatch(/Export → Text/);
    expect(getScryfallCardsByName).not.toHaveBeenCalled();
    expect(createDeck).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not create a deck when Scryfall is down", async () => {
    vi.mocked(getScryfallCardsByName).mockRejectedValueOnce(new ScryfallLookupError("timeout", "slow"));
    expect(await importDeckAction(form())).toEqual({
      error: "Scryfall took too long to answer. Try again in a moment.",
    });
    expect(createDeck).not.toHaveBeenCalled();
  });

  it("deletes the new deck when none of the cards could be saved", async () => {
    addCard.mockRejectedValueOnce(new Error("nope"));
    const result = await importDeckAction(form({
      format: "modern",
      list: "1 Sol Ring",
    }));
    expect(result).toEqual({ error: "None of those cards could be added." });
    expect(deleteDeck).toHaveBeenCalledWith(ME, DECK);
  });

  it("rejects a bad payload before looking anything up", async () => {
    expect(await importDeckAction(form({ name: "  " }))).toEqual({ error: "Deck name is required" });
    expect(getScryfallCardsByName).not.toHaveBeenCalled();
  });

  it("rate limits further imports for the same user", async () => {
    for (let i = 0; i < 10; i++) {
      await expect(importDeckAction(form())).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(await importDeckAction(form())).toEqual({
      error: RATE_LIMITED_MESSAGE,
      retryAfterSec: 600,
    });
    expect(getScryfallCardsByName).toHaveBeenCalledTimes(10);
    expect(createDeck).toHaveBeenCalledTimes(10);
  });
});
