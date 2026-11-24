import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import type { DeckCard, DeckCommander, DeckWithMeta } from "@/lib/types";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";
import { FORK_IMPORT_DENIED, FORK_IMPORT_NOT_A_FORK, FORK_IMPORT_SOURCE_HIDDEN } from "@/lib/fork-import";

// importForkDecklistAction: only the owner of a fork may preview or save.
// The diff is against the original deck. Nothing is written until confirm.

const ME = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const ORIGINAL = "d0000000-0000-4000-8000-0000000000aa";
const FORK = "d0000000-0000-4000-8000-0000000000bb";
const ATRAXA = "11111111-2222-4333-8444-555555555555";
const SOL = "22222222-3333-4444-8555-666666666666";
const FOREST = "33333333-4444-4555-8666-777777777777";
const BOLT = "44444444-5555-4666-8777-888888888888";
const SIGNET = "55555555-6666-4777-8888-999999999999";
const DELVER = "66666666-7777-4888-8999-aaaaaaaaaaaa";

const signedIn = { current: true };
const getDeck = vi.fn();
const replaceForkList = vi.fn(async () => undefined);

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => {
    if (!signedIn.current) throw new Error("NEXT_REDIRECT /login");
    return { id: ME, email: "me@example.test", username: "me_u", displayName: "Me" };
  },
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return {
    getRepository: () => ({ getDeck, replaceForkList }),
    userMessage: errors.userMessage,
    DataError: errors.DataError,
    DeckColorError: errors.DeckColorError,
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
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { importForkDecklistAction } = await import("@/lib/actions/fork-import");
const { getScryfallCardsByName } = await import("@/lib/scryfall/client");

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
  "Arcane Signet": scry({ id: SIGNET, name: "Arcane Signet", type_line: "Artifact" }),
  "Delver of Secrets": scry({
    id: DELVER,
    name: "Delver of Secrets // Insectile Aberration",
    type_line: "Creature — Human Wizard // Creature — Insect",
    card_faces: [
      { name: "Delver of Secrets", type_line: "Creature — Human Wizard", mana_cost: "{U}" },
      { name: "Insectile Aberration", type_line: "Creature — Insect", mana_cost: "" },
    ],
  }),
};

const commander: DeckCommander = {
  scryfallId: ATRAXA,
  cardName: "Atraxa, Praetors' Voice",
  typeLine: "Legendary Creature — Phyrexian Angel Horror",
  manaCost: "{G}{W}{U}{B}",
  imageUri: null,
  artUri: null,
  colorIdentity: ["W", "U", "B", "G"],
};

function row(
  scryfallId: string,
  cardName: string,
  quantity: number,
  board: "main" | "side" | "maybe" = "main",
  typeLine = "Card",
): DeckCard {
  return {
    id: scryfallId,
    deckId: ORIGINAL,
    scryfallId,
    cardName,
    imageUri: null,
    manaCost: "{1}",
    typeLine,
    colors: [],
    colorIdentity: [],
    oracleText: null,
    quantity,
    board,
    createdAt: "2026-11-11T00:00:00.000Z",
  };
}

function deck(over: Partial<DeckWithMeta> = {}): DeckWithMeta {
  return {
    id: ORIGINAL,
    ownerId: ME,
    name: "Atraxa Tokens",
    format: "commander",
    notes: "",
    visibility: "private",
    allowForks: true,
    forkedFromId: null,
    preferredBranchId: null,
    commander,
    colors: ["W", "U", "B", "G"],
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    cards: [
      row(SOL, "Sol Ring", 1, "main", "Artifact"),
      row(FOREST, "Forest", 10, "main", "Basic Land — Forest"),
      row(BOLT, "Lightning Bolt", 1, "side", "Instant"),
    ],
    ...over,
  };
}

let library: Record<string, DeckWithMeta | null>;

function form(list: string, confirm = false) {
  const data = new FormData();
  data.set("list", list);
  if (confirm) data.set("confirm", "true");
  return data;
}

const LIST = `1 Atraxa, Praetors' Voice

1 Sol Ring
1 Arcane Signet
8 Forest
`;

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  signedIn.current = true;
  library = {
    [ORIGINAL]: deck(),
    [FORK]: deck({
      id: FORK,
      name: "Atraxa Tokens (branch)",
      forkedFromId: ORIGINAL,
      cards: [],
    }),
  };
  getDeck.mockReset().mockImplementation(async (_userId: string, id: string) => library[id] ?? null);
  replaceForkList.mockReset().mockResolvedValue(undefined);
  vi.mocked(getScryfallCardsByName).mockClear();
});

describe("importForkDecklistAction authorization", () => {
  it("rejects a signed-out caller before reading or writing a deck", async () => {
    signedIn.current = false;
    await expect(importForkDecklistAction(FORK, form(LIST))).rejects.toThrow("NEXT_REDIRECT /login");
    expect(getDeck).not.toHaveBeenCalled();
    expect(replaceForkList).not.toHaveBeenCalled();
    expect(getScryfallCardsByName).not.toHaveBeenCalled();
  });

  it("rejects a non-owner and a missing deck without resolving cards", async () => {
    library[FORK] = deck({ id: FORK, ownerId: BOB, forkedFromId: ORIGINAL });
    expect(await importForkDecklistAction(FORK, form(LIST, true))).toEqual({ error: FORK_IMPORT_DENIED });

    library[FORK] = null;
    expect(await importForkDecklistAction(FORK, form(LIST, true))).toEqual({ error: FORK_IMPORT_DENIED });

    expect(await importForkDecklistAction("not-a-uuid", form(LIST, true))).toEqual({ error: FORK_IMPORT_DENIED });
    expect(replaceForkList).not.toHaveBeenCalled();
    expect(getScryfallCardsByName).not.toHaveBeenCalled();
  });

  it("refuses a deck the owner did not fork, including a copy", async () => {
    library[FORK] = deck({ id: FORK, forkedFromId: null, name: "Original list" });
    expect(await importForkDecklistAction(FORK, form(LIST, true))).toEqual({ error: FORK_IMPORT_NOT_A_FORK });

    library[FORK] = deck({ id: FORK, forkedFromId: null, copiedFromId: ORIGINAL, name: "My copy" });
    expect(await importForkDecklistAction(FORK, form(LIST, true))).toEqual({ error: FORK_IMPORT_NOT_A_FORK });
    expect(replaceForkList).not.toHaveBeenCalled();
    expect(getScryfallCardsByName).not.toHaveBeenCalled();
  });

  it("refuses the import when the original deck cannot be read", async () => {
    library[ORIGINAL] = null;
    expect(await importForkDecklistAction(FORK, form(LIST, true))).toEqual({ error: FORK_IMPORT_SOURCE_HIDDEN });
    expect(replaceForkList).not.toHaveBeenCalled();
    expect(getScryfallCardsByName).not.toHaveBeenCalled();
  });
});

describe("importForkDecklistAction preview and save", () => {
  it("previews added, removed, and quantity changes and does not write", async () => {
    const result = await importForkDecklistAction(FORK, form(LIST));
    expect(result.error).toBeUndefined();
    expect(result.saved).toBeUndefined();
    expect(replaceForkList).not.toHaveBeenCalled();
    expect(result.preview?.originalName).toBe("Atraxa Tokens");
    expect(result.preview?.commanderChange).toBe("same");
    expect(result.preview?.summary).toEqual({ added: 1, removed: 1, quantity: 1, unchanged: 1 });
    expect(result.preview?.changes).toEqual([
      expect.objectContaining({ cardName: "Arcane Signet", kind: "added", board: "main", importQty: 1 }),
      expect.objectContaining({ cardName: "Lightning Bolt", kind: "removed", board: "side", originalQty: 1 }),
      expect.objectContaining({ cardName: "Forest", kind: "quantity", originalQty: 10, importQty: 8 }),
    ]);
  });

  it("leaves a sideboard pile out of the import and shows it as removed from the original", async () => {
    library[ORIGINAL] = deck({
      format: "modern",
      commander: null,
      colors: [],
      cards: [row(SOL, "Sol Ring", 1, "main", "Artifact"), row(BOLT, "Lightning Bolt", 2, "side", "Instant")],
    });
    library[FORK] = deck({
      id: FORK,
      format: "modern",
      commander: null,
      colors: [],
      forkedFromId: ORIGINAL,
      cards: [],
    });
    const result = await importForkDecklistAction(
      FORK,
      form("1 Sol Ring\n\nSIDEBOARD\n1 Lightning Bolt\n"),
    );
    expect(result.preview?.warnings.join(" ")).toMatch(/sideboard/i);
    expect(result.preview?.changes).toEqual([
      expect.objectContaining({ cardName: "Lightning Bolt", board: "side", kind: "removed", originalQty: 2 }),
    ]);
    expect(replaceForkList).not.toHaveBeenCalled();
  });

  it("treats a double-faced front face as the same card as the original", async () => {
    library[ORIGINAL] = deck({
      format: "modern",
      commander: null,
      colors: ["U"],
      cards: [row(DELVER, "Delver of Secrets", 1, "main", "Creature — Human Wizard")],
    });
    library[FORK] = deck({
      id: FORK,
      format: "modern",
      commander: null,
      colors: ["U"],
      forkedFromId: ORIGINAL,
      cards: [],
    });
    const result = await importForkDecklistAction(FORK, form("1 Delver of Secrets"));
    expect(result.preview?.changes).toEqual([]);
    expect(result.preview?.summary.unchanged).toBe(1);
  });

  it("saves only the fork, using cards resolved from Scryfall", async () => {
    const result = await importForkDecklistAction(FORK, form(LIST, true));
    expect(result.saved).toBe(true);
    expect(replaceForkList).toHaveBeenCalledTimes(1);
    expect(replaceForkList).toHaveBeenCalledWith(
      ME,
      FORK,
      expect.objectContaining({
        colors: ["W", "U", "B", "G"],
        commander: expect.objectContaining({ cardName: "Atraxa, Praetors' Voice", scryfallId: ATRAXA }),
      }),
    );
    const calls = replaceForkList.mock.calls as unknown as [
      string,
      string,
      { cards: { cardName: string; quantity: number; scryfallId: string }[] },
    ][];
    expect(calls[0]?.[2].cards.map((card) => [card.cardName, card.quantity, card.scryfallId])).toEqual([
      ["Sol Ring", 1, SOL],
      ["Arcane Signet", 1, SIGNET],
      ["Forest", 8, FOREST],
    ]);
    expect(calls.some((call) => call[1] === ORIGINAL)).toBe(false);
  });
});
