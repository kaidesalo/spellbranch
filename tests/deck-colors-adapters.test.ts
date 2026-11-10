import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import type { CardInput } from "@/lib/data/types";
import type { DeckCommander } from "@/lib/types";
import { answeringCopyLink, createMockClient, ok, pgError, type Call } from "./helpers/supabase-mock";

// Deck colors in both repositories: cards must fit, narrowing never deletes,
// and the commander's identity must fit (or sets the colors).

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
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { localRepository: repo } = await import("@/lib/data/local");
const { createSupabaseRepository } = await import("@/lib/data/supabase");
const { DeckColorError } = await import("@/lib/data/errors");

const T = "2026-11-02T14:00:00.000Z";
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const user = (id: string, username: string): LocalUser => ({
  id, username, displayName: username, email: `${username}@example.test`, bio: "",
  avatarUrl: null, passwordHash: "salt:hash", createdAt: T,
});
const deckInput = (colors: string[] | null | undefined, format = "commander") => ({
  name: "Deck", format: format as "commander", notes: "", visibility: "public" as const, allowForks: true, colors,
});
const card = (cardName: string, colorIdentity: string[], over: Partial<CardInput> = {}): CardInput => ({
  scryfallId: `${cardName.length.toString(16).padStart(8, "0")}-0000-4000-8000-${cardName.replace(/\W/g, "").slice(0, 12).padEnd(12, "0")}`,
  cardName, imageUri: null, manaCost: null, typeLine: "Instant",
  colors: colorIdentity, colorIdentity, oracleText: null, quantity: 1, ...over,
});
const legend = (cardName: string, colorIdentity: string[]): DeckCommander => ({
  scryfallId: "11111111-2222-4333-8444-555555555555", cardName,
  typeLine: "Legendary Creature — Demon", manaCost: null, imageUri: null, artUri: null, colorIdentity,
});

async function colorError(p: Promise<unknown>) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DeckColorError);
  return err as InstanceType<typeof DeckColorError>;
}

beforeEach(() => {
  db = {
    users: [user(ALICE, "alice_u"), user(BOB, "bob_u")],
    friendships: [], favorites: [], decks: [], deckCards: [], comments: [], sessions: {},
  };
});

describe("local adapter: deck colors", () => {
  it("stores the colors in WUBRG order; Colorless is []; none is null", async () => {
    const dimir = await repo.createDeck(ALICE, deckInput(["B", "U"]));
    const colorless = await repo.createDeck(ALICE, deckInput([]));
    const legacy = await repo.createDeck(ALICE, deckInput(undefined));
    expect((await repo.getDeck(null, dimir))?.colors).toEqual(["U", "B"]);
    expect((await repo.getDeck(null, colorless))?.colors).toEqual([]);
    expect((await repo.getDeck(null, legacy))?.colors).toBeNull();
  });

  it("decks saved before deck colors read back unrestricted", async () => {
    const id = await repo.createDeck(ALICE, deckInput(["U"]));
    delete (db.decks[0] as { colors?: unknown }).colors;
    expect((await repo.getDeck(null, id))?.colors).toBeNull();
    await repo.addCard(ALICE, id, card("Fireball", ["R"]));
  });

  it("adds only cards whose identity fits; colorless always fits", async () => {
    const id = await repo.createDeck(ALICE, deckInput(["U", "B"]));
    await repo.addCard(ALICE, id, card("Counterspell", ["U"]));
    await repo.addCard(ALICE, id, card("Sol Ring", []));
    const err = await colorError(repo.addCard(ALICE, id, card("Fireball", ["R"])));
    expect(err.message).toBe("Can't add Fireball: Red is outside this deck's colors (Dimir).");
    // Identity, not card colors: a black card with a red ability.
    await colorError(repo.addCard(ALICE, id, card("Hybrid Thing", ["B", "R"], { colors: ["B"] })));
    expect((await repo.getDeck(null, id))?.cards?.map((c) => c.cardName).sort()).toEqual(["Counterspell", "Sol Ring"]);
  });

  it("a Colorless deck takes only colorless cards", async () => {
    const id = await repo.createDeck(ALICE, deckInput([]));
    await repo.addCard(ALICE, id, card("Sol Ring", []));
    await colorError(repo.addCard(ALICE, id, card("Counterspell", ["U"])));
  });

  it("narrowing is refused with the list of cards that don't fit, and deletes nothing", async () => {
    const id = await repo.createDeck(ALICE, deckInput(["W", "U", "B", "R", "G"]));
    for (const c of [card("Fireball", ["R"]), card("Kitchen Finks", ["W", "G"]), card("Counterspell", ["U"])]) {
      await repo.addCard(ALICE, id, c);
    }
    const err = await colorError(repo.updateDeck(ALICE, id, deckInput(["U", "B"])));
    expect(err.cards).toEqual(["Fireball", "Kitchen Finks"]);
    expect(err.message).toContain("2 cards don't fit");
    const deck = await repo.getDeck(null, id);
    expect(deck?.colors).toEqual(["W", "U", "B", "R", "G"]);
    expect(deck?.cards).toHaveLength(3);
    await repo.updateDeck(ALICE, id, deckInput(["W", "U", "R", "G"]));
    expect((await repo.getDeck(null, id))?.colors).toEqual(["W", "U", "R", "G"]);
  });

  it("an update without colors leaves them alone", async () => {
    const id = await repo.createDeck(ALICE, deckInput(["G"]));
    await repo.updateDeck(ALICE, id, { ...deckInput(undefined), name: "Renamed" });
    expect((await repo.getDeck(null, id))?.colors).toEqual(["G"]);
  });

  it("raising an off-color card's quantity is refused; lowering and removing aren't", async () => {
    const id = await repo.createDeck(ALICE, deckInput(null));
    await repo.addCard(ALICE, id, card("Fireball", ["R"], { quantity: 2 }));
    await repo.addCard(ALICE, id, card("Counterspell", ["U"]));
    // An off-color leftover: colors picked by a direct store edit.
    db.decks[0].colors = ["U"];
    const [fireball, counterspell] = ["Fireball", "Counterspell"].map((n) => db.deckCards.find((c) => c.cardName === n)!.id);
    await colorError(repo.setCardQuantity(ALICE, id, fireball, 3));
    await repo.setCardQuantity(ALICE, id, fireball, 1);
    await repo.setCardQuantity(ALICE, id, counterspell, 4);
    await repo.setCardQuantity(ALICE, id, fireball, 0);
    expect((await repo.getDeck(null, id))?.cards?.map((c) => [c.cardName, c.quantity])).toEqual([["Counterspell", 4]]);
  });

  it("older cards with no stored identity are checked by their colors", async () => {
    const id = await repo.createDeck(ALICE, deckInput(null));
    await repo.addCard(ALICE, id, card("Fireball", ["R"]));
    db.deckCards[0].colorIdentity = null;
    const err = await colorError(repo.updateDeck(ALICE, id, deckInput(["U"])));
    expect(err.cards).toEqual(["Fireball"]);
  });

  it("a commander on a deck with no colors gives it the commander's identity", async () => {
    const id = await repo.createDeck(ALICE, deckInput(null));
    await repo.addCard(ALICE, id, card("Terminate", ["B", "R"]));
    await repo.setCommander(ALICE, id, legend("Rakdos, Lord of Riots", ["R", "B"]));
    expect((await repo.getDeck(null, id))?.colors).toEqual(["B", "R"]);
    // Clearing the commander keeps the colors.
    await repo.setCommander(ALICE, id, null);
    expect((await repo.getDeck(null, id))?.colors).toEqual(["B", "R"]);
  });

  it("...unless a card wouldn't fit: refused with the list", async () => {
    const id = await repo.createDeck(ALICE, deckInput(null));
    await repo.addCard(ALICE, id, card("Counterspell", ["U"]));
    const err = await colorError(repo.setCommander(ALICE, id, legend("Rakdos, Lord of Riots", ["B", "R"])));
    expect(err.cards).toEqual(["Counterspell"]);
    const deck = await repo.getDeck(null, id);
    expect(deck?.commander).toBeNull();
    expect(deck?.colors).toBeNull();
  });

  it("a commander outside the deck colors is refused, naming both", async () => {
    const id = await repo.createDeck(ALICE, deckInput(["U", "B"]));
    const err = await colorError(repo.setCommander(ALICE, id, legend("Rakdos, Lord of Riots", ["B", "R"])));
    expect(err.message).toBe(
      "Rakdos, Lord of Riots's color identity (Rakdos (Black, Red)) doesn't fit this deck's colors (Dimir (Blue, Black)). Pick another commander, or widen the deck colors in Settings.",
    );
    await repo.setCommander(ALICE, id, legend("Lazav", ["U", "B"]));
    expect((await repo.getDeck(null, id))?.colors).toEqual(["U", "B"]);
  });

  it("narrowing below the commander's identity is refused; leaving Commander drops that rule", async () => {
    const id = await repo.createDeck(ALICE, deckInput(["U", "B"]));
    await repo.setCommander(ALICE, id, legend("Lazav", ["U", "B"]));
    const err = await colorError(repo.updateDeck(ALICE, id, deckInput(["U"])));
    expect(err.message).toContain("Lazav");
    await repo.updateDeck(ALICE, id, deckInput(["U"], "modern"));
    const deck = await repo.getDeck(null, id);
    expect([deck?.colors, deck?.commander]).toEqual([["U"], null]);
  });

  it("forks keep the colors and each card's identity", async () => {
    const id = await repo.createDeck(ALICE, deckInput(["U", "B"]));
    await repo.addCard(ALICE, id, card("Counterspell", ["U"]));
    const fork = await repo.forkDeck(BOB, id);
    const deck = await repo.getDeck(BOB, fork);
    expect(deck?.colors).toEqual(["U", "B"]);
    expect(deck?.cards?.[0]?.colorIdentity).toEqual(["U"]);
    await colorError(repo.addCard(BOB, fork, card("Fireball", ["R"])));
  });
});

// ---------------------------------------------------------------------------
const DECK = "d0000000-0000-4000-8000-000000000001";
const CARD = "c0000000-0000-4000-8000-000000000001";
const deckRow = (over: Record<string, unknown> = {}) => ({
  id: DECK, owner_id: ALICE, name: "EDH", format: "commander", notes: "", visibility: "public",
  allow_forks: true, forked_from_id: null, preferred_branch_id: null, created_at: T, updated_at: T,
  colors: ["U", "B"], ...over,
});
const cardRow = (card_name: string, color_identity: string[] | null, colors: string[] = color_identity ?? []) => ({
  id: CARD, card_name, colors, color_identity, quantity: 2,
});
function supa(respond: (c: Call) => ReturnType<typeof ok> | undefined) {
  const mock = createMockClient(answeringCopyLink(respond));
  return { repo: createSupabaseRepository(mock.factory), calls: mock.calls };
}
const is = (c: Call, table: string, op: Call["op"]) => c.table === table && c.op === op;
/** A 23514 raised by one of 008's deck-colors triggers (they set this hint). */
const colorTrigger = (message: string) => ({
  data: null,
  error: { code: "23514", message, hint: "spellbranch_deck_colors" },
});

describe("supabase adapter: deck colors", () => {
  it("addCard refuses an off-color card before writing, and stores the identity", async () => {
    const s = supa((c) => (is(c, "decks", "select") ? ok(deckRow()) : is(c, "deck_cards", "select") ? ok(null) : ok(null)));
    await colorError(s.repo.addCard(ALICE, DECK, card("Fireball", ["R"])));
    expect(s.calls.some((c) => c.op === "insert" || c.op === "update")).toBe(false);
    await s.repo.addCard(ALICE, DECK, card("Counterspell", ["U"]));
    expect(s.calls.find((c) => is(c, "deck_cards", "insert"))?.payload).toMatchObject({ color_identity: ["U"] });
  });

  it("a deck-colors trigger refusal (a race) becomes a clear message", async () => {
    const s = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow({ colors: null }))
        : is(c, "deck_cards", "insert") ? colorTrigger('Card "Fireball" is outside the deck colors')
          : ok(null),
    );
    const err = await colorError(s.repo.addCard(ALICE, DECK, card("Fireball", ["R"])));
    expect(err.message).toContain("doesn't fit this deck's colors");
  });

  it("only 008's errors count as color conflicts, not any 23514 that mentions colors", async () => {
    const older = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow({ colors: null }))
        : is(c, "deck_cards", "insert")
          ? pgError("23514", 'new row for relation "deck_cards" violates check constraint "deck_cards_colors_valid"')
          : ok(null),
    );
    const err = await older.repo.addCard(ALICE, DECK, card("Fireball", ["R"])).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DeckColorError);
    // Same words, no 008 hint: not a colors conflict.
    const lookalike = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow({ colors: null }))
        : is(c, "deck_cards", "insert") ? pgError("23514", "Card is outside the deck colors") : ok(null),
    );
    const err2 = await lookalike.repo.addCard(ALICE, DECK, card("Fireball", ["R"])).catch((e: unknown) => e);
    expect(err2).not.toBeInstanceOf(DeckColorError);
    // 008's own constraint, named exactly: a colors conflict.
    const named = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow({ colors: null }))
        : is(c, "deck_cards", "insert")
          ? pgError("23514", 'new row for relation "deck_cards" violates check constraint "deck_cards_color_identity_wubrg"')
          : ok(null),
    );
    await colorError(named.repo.addCard(ALICE, DECK, card("Fireball", ["R"])));
  });

  it("setCardQuantity refuses raising an off-color card, allows lowering", async () => {
    const s = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow())
        : is(c, "deck_cards", "select") ? ok(cardRow("Fireball", ["R"]))
          : is(c, "deck_cards", "update") ? ok([{ id: CARD }])
            : is(c, "decks", "update") ? ok(null) : undefined,
    );
    await colorError(s.repo.setCardQuantity(ALICE, DECK, CARD, 3));
    expect(s.calls.some((c) => is(c, "deck_cards", "update"))).toBe(false);
    await s.repo.setCardQuantity(ALICE, DECK, CARD, 1);
    expect(s.calls.find((c) => is(c, "deck_cards", "update"))?.payload).toEqual({ quantity: 1 });
  });

  it("updateDeck refuses a narrowing with the list, before writing", async () => {
    const s = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow({ colors: ["U", "B", "R"] }))
        : is(c, "deck_cards", "select") ? ok([cardRow("Fireball", ["R"]), cardRow("Old Bolt", null, ["R"]), cardRow("Counterspell", ["U"])])
          : is(c, "decks", "update") ? ok([{ id: DECK }]) : undefined,
    );
    const err = await colorError(s.repo.updateDeck(ALICE, DECK, deckInput(["U", "B"])));
    expect(err.cards).toEqual(["Fireball", "Old Bolt"]);
    expect(s.calls.some((c) => is(c, "decks", "update"))).toBe(false);
    await s.repo.updateDeck(ALICE, DECK, deckInput(["U", "B", "R", "G"]));
    expect(s.calls.find((c) => is(c, "decks", "update"))?.payload).toMatchObject({ colors: ["U", "B", "R", "G"] });
  });

  it("updateDeck without colors doesn't read cards or send colors", async () => {
    const s = supa((c) => (is(c, "decks", "update") ? ok([{ id: DECK }]) : undefined));
    await s.repo.updateDeck(ALICE, DECK, deckInput(undefined));
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].payload).not.toHaveProperty("colors");
  });

  it("setCommander on a deck with no colors writes the commander's identity as the colors", async () => {
    const s = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow({ colors: null }))
        : is(c, "deck_cards", "select") ? ok([cardRow("Terminate", ["B", "R"])])
          : is(c, "decks", "update") ? ok([{ id: DECK }]) : undefined,
    );
    await s.repo.setCommander(ALICE, DECK, legend("Rakdos, Lord of Riots", ["R", "B"]));
    const update = s.calls.find((c) => is(c, "decks", "update"))!;
    expect(update.payload).toMatchObject({ colors: ["B", "R"], commander_color_identity: ["B", "R"] });
    // Only while the deck still has no colors.
    expect(update.filters).toContainEqual(["is", "colors", null]);
  });

  it("setCommander: colors picked meanwhile are re-read and the commander checked against them", async () => {
    const run = (pickedColors: string[]) => {
      let reads = 0;
      return supa((c) => {
        if (is(c, "decks", "select")) return ok(deckRow({ colors: reads++ === 0 ? null : pickedColors }));
        if (is(c, "deck_cards", "select")) return ok([]);
        if (is(c, "decks", "update")) {
          // The guarded write finds the colors already set: 0 rows.
          return ok(c.filters.some((f) => f[0] === "is") ? [] : [{ id: DECK }]);
        }
        return undefined;
      });
    };
    const fits = run(["W", "B", "R"]);
    await fits.repo.setCommander(ALICE, DECK, legend("Rakdos, Lord of Riots", ["B", "R"]));
    const updates = fits.calls.filter((c) => is(c, "decks", "update"));
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).not.toHaveProperty("colors");
    expect(updates[1].filters).not.toContainEqual(["is", "colors", null]);

    const misfit = run(["U"]);
    const err = await colorError(misfit.repo.setCommander(ALICE, DECK, legend("Rakdos, Lord of Riots", ["B", "R"])));
    expect(err.message).toContain("doesn't fit this deck's colors (Blue)");
    expect(misfit.calls.filter((c) => is(c, "decks", "update"))).toHaveLength(1);
  });

  it("setCommander: an older 23514 that mentions colors is still the legendary-creature message", async () => {
    const s = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow())
        : is(c, "decks", "update")
          ? pgError("23514", 'new row for relation "decks" violates check constraint "decks_commander_colors_valid"')
          : undefined,
    );
    const err = await s.repo.setCommander(ALICE, DECK, legend("Lazav", ["U", "B"])).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DeckColorError);
    expect((err as Error).message).toMatch(/legendary creature/i);
  });

  it("setCommander refuses a misfit commander or misfit cards, before writing", async () => {
    const colored = supa((c) => (is(c, "decks", "select") ? ok(deckRow()) : undefined));
    await colorError(colored.repo.setCommander(ALICE, DECK, legend("Rakdos, Lord of Riots", ["B", "R"])));
    const uncolored = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow({ colors: null }))
        : is(c, "deck_cards", "select") ? ok([cardRow("Counterspell", ["U"])]) : undefined,
    );
    const err = await colorError(uncolored.repo.setCommander(ALICE, DECK, legend("Rakdos, Lord of Riots", ["B", "R"])));
    expect(err.cards).toEqual(["Counterspell"]);
    for (const r of [colored, uncolored]) expect(r.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("maps the commander-fits CHECK (a race) to a colors message, not the legendary one", async () => {
    const s = supa((c) =>
      is(c, "decks", "select") ? ok(deckRow())
        : is(c, "decks", "update") ? pgError("23514", 'new row for relation "decks" violates check constraint "decks_commander_fits_colors"')
          : undefined,
    );
    const err = await colorError(s.repo.setCommander(ALICE, DECK, legend("Lazav", ["U", "B"])));
    expect(err.message).toContain("doesn't fit this deck's colors");
  });

  it("reads colors and color identity from rows (null when absent)", async () => {
    const s = supa((c) =>
      is(c, "decks", "select") ? ok(c.single ? deckRow({ colors: ["G", "W"] }) : [deckRow({ colors: undefined })]) : ok([]),
    );
    expect((await s.repo.getDeckPermissions(ALICE, DECK)).canEdit).toBe(true);
    const deck = await s.repo.getDeck(ALICE, DECK);
    expect(deck?.colors).toEqual(["W", "G"]);
  });
});
