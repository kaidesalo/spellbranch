import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import type { DeckCommander } from "@/lib/types";
import { answeringCopyLink, createMockClient, eqValue, ok, pgError, type Call } from "./helpers/supabase-mock";

// setCommander in both repositories, plus the format-change and fork rules.

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
const { DataError, COMMANDER_MESSAGES } = await import("@/lib/data/errors");

const T = "2026-10-20T14:00:00.000Z";
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const user = (id: string, username: string): LocalUser => ({
  id, username, displayName: username, email: `${username}@example.test`, bio: "",
  avatarUrl: null, passwordHash: "salt:hash", createdAt: T,
});
const LEGEND: DeckCommander = {
  scryfallId: "11111111-2222-4333-8444-555555555555",
  cardName: "Test Legend",
  typeLine: "Legendary Creature — Elf",
  manaCost: "{2}{G}",
  imageUri: "https://cards.scryfall.io/normal/x.jpg",
  artUri: "https://cards.scryfall.io/art_crop/x.jpg",
  colorIdentity: ["G"],
};
const deckInput = (format: string) => ({
  name: "Deck", format: format as "commander", notes: "", visibility: "public" as const, allowForks: true,
});

async function rejectsWith(p: Promise<unknown>, message: string) {
  await expect(p).rejects.toBeInstanceOf(DataError);
  await expect(p).rejects.toThrow(message);
}

beforeEach(() => {
  db = {
    users: [user(ALICE, "alice_u"), user(BOB, "bob_u")],
    friendships: [], favorites: [], decks: [], deckCards: [], comments: [], sessions: {},
  };
});

describe("local adapter: commander", () => {
  it("owner sets and clears; new decks start without one", async () => {
    const id = await repo.createDeck(ALICE, deckInput("commander"));
    expect((await repo.getDeck(null, id))?.commander).toBeNull();
    await repo.setCommander(ALICE, id, LEGEND);
    expect((await repo.getDeck(null, id))?.commander).toEqual(LEGEND);
    await repo.setCommander(ALICE, id, null);
    expect((await repo.getDeck(null, id))?.commander).toBeNull();
  });

  it("non-owners can't set or clear", async () => {
    const id = await repo.createDeck(ALICE, deckInput("commander"));
    await repo.setCommander(ALICE, id, LEGEND);
    await rejectsWith(repo.setCommander(BOB, id, { ...LEGEND, cardName: "Hijack" }), "You cannot edit this deck");
    await rejectsWith(repo.setCommander(BOB, id, null), "You cannot edit this deck");
    expect((await repo.getDeck(null, id))?.commander?.cardName).toBe("Test Legend");
  });

  it("only Commander decks take a commander, and only a legendary creature", async () => {
    const modern = await repo.createDeck(ALICE, deckInput("modern"));
    await rejectsWith(repo.setCommander(ALICE, modern, LEGEND), COMMANDER_MESSAGES.notCommanderFormat);
    await repo.setCommander(ALICE, modern, null); // clearing is always fine
    const edh = await repo.createDeck(ALICE, deckInput("commander"));
    await rejectsWith(
      repo.setCommander(ALICE, edh, { ...LEGEND, typeLine: "Legendary Artifact" }),
      COMMANDER_MESSAGES.notLegendaryCreature,
    );
  });

  it("rejects a blank name and stores colors deduplicated in WUBRG order (migration 007)", async () => {
    const id = await repo.createDeck(ALICE, deckInput("commander"));
    await rejectsWith(repo.setCommander(ALICE, id, { ...LEGEND, cardName: " \t" }), COMMANDER_MESSAGES.notLegendaryCreature);
    await rejectsWith(
      repo.setCommander(ALICE, id, { ...LEGEND, typeLine: "Legendary\u00a0Creature — Elf" }),
      COMMANDER_MESSAGES.notLegendaryCreature,
    );
    await repo.setCommander(ALICE, id, { ...LEGEND, colorIdentity: ["G", "W", "G"] });
    expect((await repo.getDeck(null, id))?.commander?.colorIdentity).toEqual(["W", "G"]);
  });

  it("assertCanSetCommander: owner of a Commander deck only", async () => {
    const edh = await repo.createDeck(ALICE, deckInput("commander"));
    const modern = await repo.createDeck(ALICE, deckInput("modern"));
    await expect(repo.assertCanSetCommander(ALICE, edh)).resolves.toBeUndefined();
    await rejectsWith(repo.assertCanSetCommander(BOB, edh), "You cannot edit this deck");
    await rejectsWith(repo.assertCanSetCommander(ALICE, modern), COMMANDER_MESSAGES.notCommanderFormat);
    await rejectsWith(repo.assertCanSetCommander(ALICE, "missing"), "You cannot edit this deck");
  });

  it("drops non-Scryfall images", async () => {
    const id = await repo.createDeck(ALICE, deckInput("commander"));
    await repo.setCommander(ALICE, id, { ...LEGEND, imageUri: "https://evil.example/x.png", artUri: "javascript:x" });
    expect((await repo.getDeck(null, id))?.commander).toMatchObject({ imageUri: null, artUri: null });
  });

  it("changing the format away from Commander clears the commander; keeping it doesn't", async () => {
    const id = await repo.createDeck(ALICE, deckInput("commander"));
    await repo.setCommander(ALICE, id, LEGEND);
    await repo.updateDeck(ALICE, id, { ...deckInput("commander"), name: "Renamed" });
    expect((await repo.getDeck(null, id))?.commander).toEqual(LEGEND);
    await repo.updateDeck(ALICE, id, deckInput("modern"));
    expect((await repo.getDeck(null, id))?.commander).toBeNull();
    await repo.updateDeck(ALICE, id, deckInput("commander"));
    expect((await repo.getDeck(null, id))?.commander).toBeNull();
  });

  it("forks carry the commander; changing the fork's leaves the source alone", async () => {
    const id = await repo.createDeck(ALICE, deckInput("commander"));
    await repo.setCommander(ALICE, id, LEGEND);
    const fork = await repo.forkDeck(BOB, id);
    expect((await repo.getDeck(BOB, fork))?.commander).toEqual(LEGEND);
    await repo.setCommander(BOB, fork, { ...LEGEND, cardName: "Bob Pick" });
    expect((await repo.getDeck(null, id))?.commander?.cardName).toBe("Test Legend");
  });

  it("the commander isn't a deck-list card", async () => {
    const id = await repo.createDeck(ALICE, deckInput("commander"));
    await repo.setCommander(ALICE, id, LEGEND);
    const deck = await repo.getDeck(null, id);
    expect(deck?.cards).toEqual([]);
    expect(deck?.cardCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
const DECK = "d0000000-0000-4000-8000-000000000001";
const deckRow = (over: Record<string, unknown> = {}) => ({
  id: DECK, owner_id: ALICE, name: "EDH", format: "commander", notes: "", visibility: "public",
  allow_forks: true, forked_from_id: null, preferred_branch_id: null, created_at: T, updated_at: T,
  colors: ["W", "U", "B", "R", "G"],
  ...over,
});
const commanderRow = {
  commander_scryfall_id: LEGEND.scryfallId, commander_name: LEGEND.cardName,
  commander_type_line: LEGEND.typeLine, commander_mana_cost: LEGEND.manaCost,
  commander_image_uri: LEGEND.imageUri, commander_art_uri: LEGEND.artUri,
  commander_color_identity: LEGEND.colorIdentity,
};
const cleared = {
  commander_scryfall_id: null, commander_name: null, commander_type_line: null,
  commander_mana_cost: null, commander_image_uri: null, commander_art_uri: null,
  commander_color_identity: [],
};

function supa(respond: (c: Call) => ReturnType<typeof ok> | undefined) {
  const mock = createMockClient(answeringCopyLink(respond));
  return { repo: createSupabaseRepository(mock.factory), calls: mock.calls };
}
const isDeckSelect = (c: Call) => c.table === "decks" && c.op === "select";
const isDeckUpdate = (c: Call) => c.table === "decks" && c.op === "update";

describe("supabase adapter: commander", () => {
  it("sets with an owner + format guarded UPDATE", async () => {
    const { repo: s, calls } = supa((c) => {
      if (isDeckSelect(c)) return ok(deckRow());
      if (isDeckUpdate(c)) return ok([{ id: DECK }]);
    });
    await s.setCommander(ALICE, DECK, LEGEND);
    const upd = calls.find(isDeckUpdate)!;
    expect(upd.payload).toEqual(commanderRow);
    expect(upd.filters).toEqual([["eq", "id", DECK], ["eq", "owner_id", ALICE], ["eq", "format", "commander"]]);
  });

  it("clears every column", async () => {
    const { repo: s, calls } = supa((c) => {
      if (isDeckSelect(c)) return ok(deckRow({ format: "modern" }));
      if (isDeckUpdate(c)) return ok([{ id: DECK }]);
    });
    await s.setCommander(ALICE, DECK, null);
    const upd = calls.find(isDeckUpdate)!;
    expect(upd.payload).toEqual(cleared);
    expect(eqValue(upd, "format")).toBeUndefined();
  });

  it("refuses non-owners, non-Commander decks and non-legendary types before writing", async () => {
    const other = supa((c) => (isDeckSelect(c) ? ok(deckRow({ owner_id: BOB })) : undefined));
    await rejectsWith(other.repo.setCommander(ALICE, DECK, LEGEND), "You cannot edit this deck");
    const modern = supa((c) => (isDeckSelect(c) ? ok(deckRow({ format: "modern" })) : undefined));
    await rejectsWith(modern.repo.setCommander(ALICE, DECK, LEGEND), COMMANDER_MESSAGES.notCommanderFormat);
    const edh = supa((c) => (isDeckSelect(c) ? ok(deckRow()) : undefined));
    await rejectsWith(
      edh.repo.setCommander(ALICE, DECK, { ...LEGEND, typeLine: "Legendary Artifact" }),
      COMMANDER_MESSAGES.notLegendaryCreature,
    );
    await rejectsWith(edh.repo.setCommander(ALICE, "not-a-uuid", LEGEND), "You cannot edit this deck");
    for (const r of [other, modern, edh]) expect(r.calls.some(isDeckUpdate)).toBe(false);
  });

  it("refuses a blank name or NBSP type line before writing; writes normalized colors", async () => {
    const edh = supa((c) => {
      if (isDeckSelect(c)) return ok(deckRow());
      if (isDeckUpdate(c)) return ok([{ id: DECK }]);
    });
    await rejectsWith(edh.repo.setCommander(ALICE, DECK, { ...LEGEND, cardName: "  " }), COMMANDER_MESSAGES.notLegendaryCreature);
    await rejectsWith(
      edh.repo.setCommander(ALICE, DECK, { ...LEGEND, typeLine: "Legendary\u00a0Creature" }),
      COMMANDER_MESSAGES.notLegendaryCreature,
    );
    expect(edh.calls.some(isDeckUpdate)).toBe(false);
    await edh.repo.setCommander(ALICE, DECK, { ...LEGEND, colorIdentity: ["G", "U", "G"] });
    expect(edh.calls.find(isDeckUpdate)!.payload).toMatchObject({ commander_color_identity: ["U", "G"] });
  });

  it("assertCanSetCommander reads the deck and never writes", async () => {
    const own = supa((c) => (isDeckSelect(c) ? ok(deckRow()) : undefined));
    await expect(own.repo.assertCanSetCommander(ALICE, DECK)).resolves.toBeUndefined();
    const other = supa((c) => (isDeckSelect(c) ? ok(deckRow({ owner_id: BOB })) : undefined));
    await rejectsWith(other.repo.assertCanSetCommander(ALICE, DECK), "You cannot edit this deck");
    const modern = supa((c) => (isDeckSelect(c) ? ok(deckRow({ format: "modern" })) : undefined));
    await rejectsWith(modern.repo.assertCanSetCommander(ALICE, DECK), COMMANDER_MESSAGES.notCommanderFormat);
    const bad = supa(() => undefined);
    await rejectsWith(bad.repo.assertCanSetCommander(ALICE, "not-a-uuid"), "You cannot edit this deck");
    expect(bad.calls).toEqual([]);
    for (const r of [own, other, modern]) expect(r.calls.some(isDeckUpdate)).toBe(false);
  });

  it("maps a CHECK violation and a lost format race to clean messages", async () => {
    const check = supa((c) => (isDeckSelect(c) ? ok(deckRow()) : isDeckUpdate(c) ? pgError("23514") : undefined));
    await rejectsWith(check.repo.setCommander(ALICE, DECK, LEGEND), COMMANDER_MESSAGES.notLegendaryCreature);
    const race = supa((c) => (isDeckSelect(c) ? ok(deckRow()) : isDeckUpdate(c) ? ok([]) : undefined));
    await rejectsWith(race.repo.setCommander(ALICE, DECK, LEGEND), COMMANDER_MESSAGES.notCommanderFormat);
  });

  it("updateDeck clears the commander in the same UPDATE when leaving Commander", async () => {
    const { repo: s, calls } = supa((c) => (isDeckUpdate(c) ? ok([{ id: DECK }]) : undefined));
    await s.updateDeck(ALICE, DECK, deckInput("modern"));
    expect(calls[0].payload).toMatchObject(cleared);
    await s.updateDeck(ALICE, DECK, deckInput("commander"));
    expect(calls[1].payload).not.toHaveProperty("commander_scryfall_id");
  });

  it("reads the commander from the deck row (null when incomplete)", async () => {
    const full = supa((c) => {
      if (isDeckSelect(c) && c.single) return ok(deckRow(commanderRow));
      if (c.table === "deck_cards" || c.table === "decks" || c.table === "public_profiles") return ok([]);
    });
    expect((await full.repo.getDeck(null, DECK))?.commander).toEqual(LEGEND);
    const partial = supa((c) => {
      if (isDeckSelect(c) && c.single) return ok(deckRow({ ...cleared, commander_name: "Orphan" }));
      if (c.table === "deck_cards" || c.table === "decks" || c.table === "public_profiles") return ok([]);
    });
    expect((await partial.repo.getDeck(null, DECK))?.commander).toBeNull();
  });

  it("normalizes colors read from the row", async () => {
    const odd = supa((c) => {
      if (isDeckSelect(c) && c.single) {
        return ok(deckRow({ ...commanderRow, commander_color_identity: [["G", "W"], ["G"]] }));
      }
      if (c.table === "deck_cards" || c.table === "decks" || c.table === "public_profiles") return ok([]);
    });
    expect((await odd.repo.getDeck(null, DECK))?.commander?.colorIdentity).toEqual(["W", "G"]);
  });
});
