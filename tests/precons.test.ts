import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/lib/data/store";
import type { Deck } from "@/lib/types";
import sample from "./fixtures/precon-sample.json";
import {
  mapPrecon,
  officialCommanderTypeLine,
  preconId,
  renderPreconPreflight,
  renderPreconSeed,
  selectCommanderDecks,
  type DeckListEntry,
  type MtgjsonDeckFile,
} from "@/lib/precons/import";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const entry: DeckListEntry = {
  code: "EOC",
  fileName: "CounterIntelligence_EOC",
  name: "Counter Intelligence",
  releaseDate: "2025-08-01",
  type: "Commander Deck",
};

let db: DataStore;
vi.mock("@/lib/data/store", () => ({
  readStore: async () => structuredClone(db),
  updateStore: async <T>(fn: (store: DataStore) => T | Promise<T>) => {
    const copy = structuredClone(db);
    const result = await fn(copy);
    db = copy;
    return result;
  },
}));

const { localRepository: repo } = await import("@/lib/data/local");
const { DataError } = await import("@/lib/data/errors");
const { DeckCardSummary } = await import("@/components/decks/deck-card-summary");

const ME = "a0000000-0000-4000-8000-000000000001";
const T = "2026-11-18T00:00:00.000Z";

function preconDeck(): Deck {
  const mapped = mapPrecon(entry, sample as MtgjsonDeckFile);
  return {
    id: mapped.id,
    ownerId: null,
    isPrecon: true,
    name: mapped.name,
    format: "commander",
    notes: mapped.notes,
    visibility: "public",
    allowForks: true,
    forkedFromId: null,
    copiedFromId: null,
    preferredBranchId: null,
    commander: {
      scryfallId: mapped.commander.scryfallId,
      cardName: mapped.commander.cardName,
      typeLine: mapped.commander.typeLine,
      manaCost: mapped.commander.manaCost,
      imageUri: mapped.commander.imageUri,
      artUri: null,
      colorIdentity: mapped.commander.colorIdentity,
    },
    colors: mapped.colors,
    createdAt: T,
    updatedAt: T,
  };
}

beforeEach(() => {
  const deck = preconDeck();
  const mapped = mapPrecon(entry, sample as MtgjsonDeckFile);
  db = {
    users: [],
    friendships: [],
    favorites: [],
    decks: [deck],
    deckCards: mapped.cards.map((card, index) => ({
      id: `card-${index}`,
      deckId: deck.id,
      scryfallId: card.scryfallId,
      cardName: card.cardName,
      imageUri: card.imageUri,
      manaCost: card.manaCost,
      typeLine: card.typeLine,
      colors: card.colors,
      colorIdentity: card.colorIdentity,
      oracleText: card.oracleText,
      quantity: card.quantity,
      board: "main" as const,
      createdAt: T,
    })),
    comments: [],
    sessions: {},
  };
});

describe("precon importer", () => {
  it("keeps Commander decks inside the release window and skips the rest", () => {
    const picked = selectCommanderDecks([
      entry,
      { ...entry, fileName: "Old_TDC", releaseDate: "2025-04-11", name: "Old" },
      { ...entry, fileName: "Theme_X", type: "Theme Deck" },
      { ...entry, fileName: "Later_SLD", releaseDate: "2026-11-19", name: "Later" },
    ]);
    expect(picked.map((deck) => deck.fileName)).toEqual(["CounterIntelligence_EOC"]);
  });

  it("maps the commander, exact printing, and merged quantity to stable ids", () => {
    const deck = mapPrecon(entry, sample as MtgjsonDeckFile);
    expect(deck.id).toBe(preconId(entry.fileName));
    expect(mapPrecon(entry, sample as MtgjsonDeckFile).id).toBe(deck.id);
    expect(deck.commander.cardName).toBe("Inspirit, Flagship Vessel");
    expect(deck.commander.scryfallId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(deck.commander.colorIdentity).toEqual(["W", "U", "R"]);
    expect(officialCommanderTypeLine(deck.commander.typeLine)).toBe(true);
    expect(officialCommanderTypeLine("Legendary Planeswalker — Jace")).toBe(true);
    expect(officialCommanderTypeLine("Legendary Artifact — Vehicle")).toBe(false);
    const island = deck.cards.find((card) => card.cardName === "Island");
    expect(island?.quantity).toBe(5);
    expect(island?.scryfallId).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(deck.cards.map((card) => card.cardName)).toEqual(["Island", "Partner Pilot", "Sol Ring"]);
    const sql = renderPreconSeed([deck]);
    expect(sql.indexOf("raise exception")).toBeGreaterThan(0);
    expect(sql.indexOf("raise exception")).toBeLessThan(sql.indexOf("insert into public.decks"));
    expect(sql).toContain("owner_id is not null or is_precon = false");
    expect(sql).toContain("where decks.is_precon or decks.owner_id is null");
    expect(sql).toContain("on conflict (deck_id, scryfall_id, board) do update");
    expect(sql).toContain("d.is_precon or d.owner_id is null");
    expect(sql).toContain(deck.commander.scryfallId);
    const preflight = renderPreconPreflight([deck]);
    expect(preflight).toContain(deck.id);
    expect(preflight).toContain("null_owner_decks");
    expect(preflight.toLowerCase()).not.toMatch(/\b(insert|update|delete|create|drop|alter|truncate|temp)\b/);
  });
});

describe("precon decks", () => {
  it("lists precons for a signed-out visitor and keeps them out of public decks", async () => {
    const precons = await repo.listDecks(null, "precons");
    const pub = await repo.listDecks(null, "public");
    expect(precons.map((deck) => deck.name)).toEqual(["Counter Intelligence"]);
    expect(pub).toEqual([]);
    expect(await repo.getDeckPermissions(ME, precons[0]!.id)).toMatchObject({
      canEdit: false,
      canFork: true,
      canCopy: true,
    });
  });

  it("refuses edits and gives the copy and the branch to the caller", async () => {
    const id = db.decks[0]!.id;
    await expect(repo.updateDeck(ME, id, { name: "Renamed", format: "commander", notes: "", visibility: "public", allowForks: true })).rejects.toBeInstanceOf(DataError);
    await expect(repo.deleteDeck(ME, id)).rejects.toBeInstanceOf(DataError);
    await expect(
      repo.addCard(ME, id, {
        scryfallId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        cardName: "Opt",
        imageUri: null,
        manaCost: "{U}",
        typeLine: "Instant",
        colors: ["U"],
        colorIdentity: ["U"],
        oracleText: null,
        quantity: 1,
        board: "main",
      }),
    ).rejects.toBeInstanceOf(DataError);

    const copyId = await repo.copyDeck(ME, id, "My Counter Intelligence");
    const forkId = await repo.forkDeck(ME, id, "Counter Intelligence branch");
    const copy = db.decks.find((deck) => deck.id === copyId);
    const fork = db.decks.find((deck) => deck.id === forkId);
    expect(copy).toMatchObject({ ownerId: ME, isPrecon: false, copiedFromId: id, forkedFromId: null });
    expect(fork).toMatchObject({ ownerId: ME, isPrecon: false, forkedFromId: id });
    expect(db.deckCards.filter((card) => card.deckId === copyId).map((card) => card.quantity).sort()).toEqual([1, 1, 5]);
    expect(db.decks[0]).toMatchObject({ ownerId: null, isPrecon: true, name: "Counter Intelligence" });
  });

  it("shows a Precon badge", () => {
    const html = renderToStaticMarkup(
      createElement(DeckCardSummary, {
        deck: {
          ...db.decks[0]!,
          cardCount: 99,
          forkCount: 0,
        },
      }),
    );
    expect(html).toContain("Precon");
    expect(html).toContain('data-testid="precon-badge"');
    expect(html).toContain("Inspirit, Flagship Vessel");
  });
});
