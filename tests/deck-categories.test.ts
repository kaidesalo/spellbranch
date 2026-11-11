import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { groupCardsByType } from "@/lib/card-types";
import {
  CATEGORY_MESSAGES,
  CATEGORY_POSITION_START,
  categoryNameLength,
  groupDeckCards,
  nextCategoryPosition,
  normalizeCategoryName,
  parseSectionOrder,
} from "@/lib/deck-categories";
import { LIMITS } from "@/lib/data/limits";
import type { DataStore, LocalUser } from "@/lib/data/store";
import type { DeckCard, DeckCategory, DeckTypeOrder } from "@/lib/types";

// Grouping is pure. The local adapter is the same rules the database enforces
// for names, fallback on delete, and copying categories onto a fork or copy.

vi.mock("@/lib/actions/decks", () => ({
  updateCardQuantityAction: vi.fn(async () => ({ success: true })),
  moveCardToCategoryAction: vi.fn(async () => ({ success: true })),
  removeCardFromDeckAction: vi.fn(async () => ({ success: true })),
}));

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

const { DeckList } = await import("@/components/decks/deck-list");
const { localRepository: repo } = await import("@/lib/data/local");
const { DataError } = await import("@/lib/data/errors");

const DECK = "d0000000-0000-4000-8000-000000000001";
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const T = "2026-11-01T00:00:00.000Z";

function card(name: string, typeLine: string, quantity = 1, categoryId: string | null = null): DeckCard {
  return {
    id: name,
    deckId: DECK,
    scryfallId: name,
    cardName: name,
    imageUri: null,
    manaCost: null,
    typeLine,
    colors: [],
    oracleText: null,
    quantity,
    categoryId,
    createdAt: T,
  };
}

function category(id: string, name: string, position: number): DeckCategory {
  return { id, deckId: DECK, name, position, createdAt: T, updatedAt: T };
}

const user = (id: string, username: string): LocalUser => ({
  id,
  username,
  displayName: username,
  email: `${username}@example.test`,
  bio: "",
  avatarUrl: null,
  passwordHash: "salt:hash",
  createdAt: T,
});

beforeEach(() => {
  db = {
    users: [user(ALICE, "alice"), user(BOB, "bob")],
    friendships: [],
    favorites: [],
    decks: [],
    deckCards: [],
    comments: [],
    sessions: {},
  };
});

describe("category names", () => {
  it("trims and counts emoji with Array.from, not UTF-16 length", () => {
    const forty = "👍".repeat(40);
    expect(forty.length).toBe(80);
    expect(categoryNameLength(forty)).toBe(40);
    expect(normalizeCategoryName(`  ${forty}  `)).toEqual({ ok: true, name: forty });
    expect(normalizeCategoryName("👍".repeat(41))).toEqual({ ok: false, error: CATEGORY_MESSAGES.tooLong });
    expect(LIMITS.categoryName).toBe(40);
  });

  it("rejects empty, over-long, and line breaks", () => {
    expect(normalizeCategoryName("   ")).toEqual({ ok: false, error: CATEGORY_MESSAGES.required });
    expect(normalizeCategoryName("a".repeat(41))).toEqual({ ok: false, error: CATEGORY_MESSAGES.tooLong });
    expect(normalizeCategoryName("Ra\nmp")).toEqual({ ok: false, error: CATEGORY_MESSAGES.lineBreak });
  });
});

describe("groupDeckCards", () => {
  const cards = [
    card("Solemn Simulacrum", "Artifact Creature — Golem"),
    card("Sol Ring", "Artifact"),
    card("Darksteel Citadel", "Artifact Land"),
    card("Lightning Bolt", "Instant", 4),
    card("Opt", "Instant"),
  ];

  it("matches the type piles when nothing is assigned", () => {
    const grouped = groupDeckCards(cards, []);
    const legacy = groupCardsByType(cards);
    expect(grouped.map((g) => [g.label, g.count, g.cards.map((c) => c.cardName)])).toEqual(
      legacy.map((g) => [g.type, g.count, g.cards.map((c) => c.cardName)]),
    );
    expect(grouped.map((g) => g.label)).toEqual(["Creature", "Instant", "Artifact", "Land"]);
  });

  it("puts an assigned card in that category and leaves the rest in type groups", () => {
    const ramp = category("cat-ramp", "Ramp", CATEGORY_POSITION_START);
    const assigned = cards.map((c) => (c.cardName === "Sol Ring" ? { ...c, categoryId: ramp.id } : c));
    const grouped = groupDeckCards(assigned, [ramp]);
    expect(grouped.map((g) => g.label)).toEqual(["Creature", "Instant", "Land", "Ramp"]);
    const rampGroup = grouped.find((g) => g.label === "Ramp")!;
    expect(rampGroup.cards.map((c) => c.cardName)).toEqual(["Sol Ring"]);
    expect(rampGroup.kind).toBe("category");
    expect(grouped.find((g) => g.label === "Artifact")).toBeUndefined();
  });

  it("shows an empty custom category and falls back when the assignment is unknown", () => {
    const draw = category("cat-draw", "Card draw", CATEGORY_POSITION_START);
    const grouped = groupDeckCards(
      [card("Opt", "Instant", 1, "missing-category")],
      [draw],
    );
    expect(grouped.map((g) => g.label)).toEqual(["Instant", "Card draw"]);
    expect(grouped.find((g) => g.label === "Card draw")!.cards).toEqual([]);
    expect(grouped.find((g) => g.label === "Instant")!.cards.map((c) => c.cardName)).toEqual(["Opt"]);
  });

  it("reorders type groups among categories when the owner has placed them", () => {
    const ramp = category("cat-ramp", "Ramp", 0);
    const orders: DeckTypeOrder[] = [
      { deckId: DECK, typeKey: "Instant", position: 1 },
      { deckId: DECK, typeKey: "Creature", position: 2 },
    ];
    const grouped = groupDeckCards(
      [
        card("Birds", "Creature — Bird"),
        card("Bolt", "Instant"),
        { ...card("Sol Ring", "Artifact"), categoryId: "cat-ramp" },
      ],
      [ramp],
      orders,
    );
    expect(grouped.map((g) => g.label)).toEqual(["Ramp", "Instant", "Creature"]);
  });

  it("appends a type group that was not part of the arrangement", () => {
    const ramp = category("cat-ramp", "Ramp", 0);
    const orders: DeckTypeOrder[] = [{ deckId: DECK, typeKey: "Creature", position: 1 }];
    const grouped = groupDeckCards(
      [card("Birds", "Creature — Bird"), card("Island", "Basic Land — Island")],
      [ramp],
      orders,
    );
    expect(grouped.map((g) => g.label)).toEqual(["Ramp", "Creature", "Land"]);
  });

  it("refuses a reorder that drops a category", () => {
    const a = "c0000000-0000-4000-8000-00000000000a";
    const b = "c0000000-0000-4000-8000-00000000000b";
    expect(parseSectionOrder([a, b], [a, "type:Land"]).ok).toBe(false);
    expect(parseSectionOrder([a], [a, a]).ok).toBe(false);
    expect(parseSectionOrder([a], ["type:Commander", a]).ok).toBe(false);
    expect(parseSectionOrder([a], ["type:Land", a])).toEqual({
      ok: true,
      items: [
        { kind: "type", typeKey: "Land" },
        { kind: "category", id: a },
      ],
    });
  });

  it("starts new categories after the default type groups", () => {
    expect(nextCategoryPosition([])).toBe(CATEGORY_POSITION_START);
    // A reorder packs positions from 0. A new category still starts at 1000,
    // which is after both the packed list and the default type groups.
    expect(nextCategoryPosition([{ position: 2 }])).toBe(CATEGORY_POSITION_START);
    expect(nextCategoryPosition([{ position: 1000 }])).toBe(1001);
  });
});

describe("DeckList categories", () => {
  it("shows a custom category and a Move control for the owner", () => {
    const html = renderToStaticMarkup(
      createElement(DeckList, {
        deckId: DECK,
        canEdit: true,
        categories: [category("cat-ramp", "Ramp", CATEGORY_POSITION_START)],
        cards: [
          card("Sol Ring", "Artifact", 1, "cat-ramp"),
          card("Birds of Paradise", "Creature — Bird"),
        ],
      }),
    );
    const rampAt = html.indexOf(">Ramp<");
    const creatureAt = html.indexOf(">Creature<");
    expect(rampAt).toBeGreaterThan(-1);
    expect(creatureAt).toBeGreaterThan(-1);
    expect(creatureAt).toBeLessThan(rampAt);
    expect(html.slice(rampAt)).toContain("Sol Ring");
    expect(html.slice(creatureAt, rampAt)).toContain("Birds of Paradise");
    expect(html.slice(creatureAt, rampAt)).not.toContain("Sol Ring");
    expect(html).toContain('aria-label="Move Sol Ring to a category"');
    expect(html).toContain('aria-label="Move Birds of Paradise to a category"');
  });

  it("viewers see the grouping and no move control", () => {
    const html = renderToStaticMarkup(
      createElement(DeckList, {
        deckId: DECK,
        canEdit: false,
        categories: [category("cat-ramp", "Ramp", CATEGORY_POSITION_START)],
        cards: [card("Sol Ring", "Artifact", 1, "cat-ramp")],
      }),
    );
    expect(html).toContain(">Ramp<");
    expect(html).not.toContain("Move Sol Ring");
    expect(html).not.toContain("<button");
  });
});

describe("local adapter categories", () => {
  const input = {
    scryfallId: "sol-ring",
    cardName: "Sol Ring",
    imageUri: null,
    manaCost: "{1}",
    typeLine: "Artifact",
    colors: [],
    colorIdentity: [],
    oracleText: null,
    quantity: 1,
  };

  async function ownedDeck() {
    return repo.createDeck(ALICE, {
      name: "Artifacts",
      format: "commander",
      notes: "",
      visibility: "public",
      allowForks: true,
      colors: [],
    });
  }

  it("new cards stay unassigned, and a move, rename, reorder, and delete fall back", async () => {
    const deckId = await ownedDeck();
    await repo.addCard(ALICE, deckId, input);
    await repo.addCard(ALICE, deckId, { ...input, scryfallId: "birds", cardName: "Birds", typeLine: "Creature — Bird" });
    const before = await repo.getDeck(ALICE, deckId);
    expect(before?.categories).toEqual([]);
    expect(before?.cards?.every((c) => !c.categoryId)).toBe(true);

    const ramp = await repo.createCategory(ALICE, deckId, "  Ramp  ");
    const sol = db.deckCards.find((c) => c.cardName === "Sol Ring")!;
    await repo.moveCardToCategory(ALICE, deckId, sol.id, ramp);
    let deck = await repo.getDeck(ALICE, deckId);
    expect(deck?.categories?.map((c) => c.name)).toEqual(["Ramp"]);
    expect(deck?.cards?.find((c) => c.cardName === "Sol Ring")?.categoryId).toBe(ramp);
    expect(groupDeckCards(deck!.cards!, deck!.categories!, deck!.typeSectionOrders).map((g) => g.label)).toEqual([
      "Creature",
      "Ramp",
    ]);

    await repo.renameCategory(ALICE, deckId, ramp, "Rocks");
    await expect(repo.createCategory(ALICE, deckId, "rocks")).rejects.toThrow(CATEGORY_MESSAGES.duplicate);
    await repo.reorderSections(ALICE, deckId, [ramp, "type:Creature"]);
    deck = await repo.getDeck(ALICE, deckId);
    expect(groupDeckCards(deck!.cards!, deck!.categories!, deck!.typeSectionOrders).map((g) => g.label)).toEqual([
      "Rocks",
      "Creature",
    ]);

    await repo.deleteCategory(ALICE, deckId, ramp);
    deck = await repo.getDeck(ALICE, deckId);
    expect(deck?.categories).toEqual([]);
    expect(deck?.cards).toHaveLength(2);
    expect(deck?.cards?.find((c) => c.cardName === "Sol Ring")?.categoryId).toBeNull();
    expect(groupDeckCards(deck!.cards!, [], []).map((g) => g.label)).toEqual(["Creature", "Artifact"]);
  });

  it("a non-owner cannot edit, and a viewer still sees the grouping", async () => {
    const deckId = await ownedDeck();
    await repo.addCard(ALICE, deckId, input);
    const ramp = await repo.createCategory(ALICE, deckId, "Ramp");
    const sol = db.deckCards.find((c) => c.cardName === "Sol Ring")!;
    await repo.moveCardToCategory(ALICE, deckId, sol.id, ramp);

    await expect(repo.createCategory(BOB, deckId, "Nope")).rejects.toBeInstanceOf(DataError);
    await expect(repo.deleteCategory(BOB, deckId, ramp)).rejects.toThrow(CATEGORY_MESSAGES.denied);
    await expect(repo.moveCardToCategory(BOB, deckId, sol.id, null)).rejects.toThrow(CATEGORY_MESSAGES.denied);

    const asBob = await repo.getDeck(BOB, deckId);
    expect(asBob?.categories?.map((c) => c.name)).toEqual(["Ramp"]);
    expect(asBob?.cards?.find((c) => c.cardName === "Sol Ring")?.categoryId).toBe(ramp);

    await repo.updateDeck(ALICE, deckId, {
      name: "Artifacts",
      format: "commander",
      notes: "",
      visibility: "private",
      allowForks: false,
    });
    expect(await repo.getDeck(BOB, deckId)).toBeNull();
  });

  it("forks and copies carry categories and assignments", async () => {
    const deckId = await ownedDeck();
    await repo.addCard(ALICE, deckId, input);
    const ramp = await repo.createCategory(ALICE, deckId, "Ramp");
    const sol = db.deckCards.find((c) => c.cardName === "Sol Ring")!;
    await repo.moveCardToCategory(ALICE, deckId, sol.id, ramp);
    await repo.reorderSections(ALICE, deckId, ["type:Artifact", ramp]);

    const forkId = await repo.forkDeck(BOB, deckId);
    const copyId = await repo.copyDeck(BOB, deckId);
    for (const id of [forkId, copyId]) {
      const next = await repo.getDeck(BOB, id);
      expect(next?.categories?.map((c) => c.name)).toEqual(["Ramp"]);
      expect(next?.categories?.[0]?.id).not.toBe(ramp);
      const cardRow = next?.cards?.find((c) => c.cardName === "Sol Ring");
      expect(cardRow?.categoryId).toBe(next?.categories?.[0]?.id);
      expect(next?.typeSectionOrders?.map((t) => t.typeKey)).toEqual(["Artifact"]);
    }
    expect(db.decks.find((d) => d.id === forkId)?.forkedFromId).toBe(deckId);
    expect(db.decks.find((d) => d.id === copyId)?.copiedFromId).toBe(deckId);
    expect(db.decks.find((d) => d.id === copyId)?.forkedFromId).toBeNull();
  });

  it("deleting the deck removes its categories and does not remove another deck's", async () => {
    const deckId = await ownedDeck();
    const other = await repo.createDeck(ALICE, {
      name: "Other",
      format: "modern",
      notes: "",
      visibility: "private",
      allowForks: false,
      colors: [],
    });
    await repo.createCategory(ALICE, deckId, "Ramp");
    const kept = await repo.createCategory(ALICE, other, "Kept");
    await repo.deleteDeck(ALICE, deckId);
    expect(db.deckCategories?.map((c) => c.id)).toEqual([kept]);
  });
});

describe("migration 013", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../supabase/migrations/013_deck_categories.sql"),
    "utf8",
  );

  it("is its own transaction and does not touch 012", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).not.toMatch(/profile_bio|012_profile/);
    expect(sql).not.toMatch(/select \*/i);
  });

  it("enables RLS, gates writes on ownership, and reads through the deck", () => {
    expect(sql).toMatch(/alter table public\.deck_categories enable row level security/);
    expect(sql).toMatch(/alter table public\.deck_type_orders enable row level security/);
    expect(sql).toMatch(/d\.owner_id = auth\.uid\(\)/);
    expect(sql).toMatch(/where d\.id = deck_categories\.deck_id/);
    expect(sql).toMatch(/where d\.id = deck_type_orders\.deck_id/);
    expect(sql).toMatch(/on delete set null/);
    expect(sql).toMatch(/char_length\(name\) between 1 and 40/);
    expect(sql).toMatch(/deck_categories_name_lower/);
    expect(sql).toMatch(/This deck already has 40 categories/);
    expect(sql).toMatch(/for update;/);
    expect(sql).toMatch(/new\.deck_id is distinct from old\.deck_id/);
    expect(sql).toMatch(/grant update \(name, position\) on table public\.deck_categories to authenticated;/);
    expect(LIMITS.deckCategories).toBe(40);
  });

  it("copies categories from fork_deck and copy_deck without a granted helper", () => {
    const fork = sql.slice(sql.indexOf("function public.fork_deck"), sql.indexOf("function public.copy_deck"));
    const copy = sql.slice(sql.indexOf("function public.copy_deck"));
    for (const body of [fork, copy]) {
      expect(body).toMatch(/security invoker/);
      expect(body).not.toMatch(/security definer/);
      expect(body).toMatch(/insert into public\.deck_categories/);
      expect(body).toMatch(/insert into public\.deck_type_orders/);
      expect(body).toMatch(/category_id/);
      expect(body).toMatch(/coalesce\(color_identity/);
      expect(body).not.toMatch(/select \*/i);
    }
    expect(sql).toMatch(/function public\.set_deck_section_order/);
    expect(sql).toMatch(/revoke execute on function public\.set_deck_section_order\(uuid, text\[\]\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.set_deck_section_order\(uuid, text\[\]\) to authenticated/);
    expect(sql).not.toMatch(/security definer/);
  });
});
