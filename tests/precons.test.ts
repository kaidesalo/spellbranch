import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/lib/data/store";
import type { Deck } from "@/lib/types";
import sample from "./fixtures/precon-sample.json";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  importOnePrecon,
  mapPrecon,
  officialCommanderTypeLine,
  preconId,
  renderPreconPreflight,
  renderPreconReport,
  renderPreconSeed,
  renderPreconSeedBatches,
  selectCommanderDecks,
  type DeckListEntry,
  type MtgjsonDeckFile,
  type PrintingHit,
} from "@/lib/precons/import";
import { browsePreconDecks, preconListHref, searchPreconCatalog } from "@/lib/precons/browse";
import stableIds from "./fixtures/precon-stable-ids.json";

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
  it("keeps every Commander deck and skips other deck types", () => {
    const picked = selectCommanderDecks([
      entry,
      { ...entry, fileName: "Counterpunch_CMD", releaseDate: "2011-06-17", name: "Counterpunch" },
      { ...entry, fileName: "Theme_X", type: "Theme Deck" },
      { ...entry, fileName: "Later_SLD", releaseDate: "2030-01-01", name: "Later" },
    ]);
    expect(picked.map((deck) => deck.fileName)).toEqual([
      "Counterpunch_CMD",
      "CounterIntelligence_EOC",
      "Later_SLD",
    ]);
  });

  it("still honors an explicit release window", () => {
    const picked = selectCommanderDecks(
      [
        entry,
        { ...entry, fileName: "Old_TDC", releaseDate: "2025-04-11", name: "Old" },
        { ...entry, fileName: "Later_SLD", releaseDate: "2026-11-19", name: "Later" },
      ],
      "2025-05-18",
      "2026-11-18",
    );
    expect(picked.map((deck) => deck.fileName)).toEqual(["CounterIntelligence_EOC"]);
  });

  it("keeps the original 43 precon ids and does not touch a fork id", () => {
    expect(stableIds).toHaveLength(43);
    const seedDir = path.join(process.cwd(), "supabase", "seed");
    const sql = readdirSync(seedDir)
      .filter((name) => /^precons-\d+\.sql$/.test(name))
      .sort()
      .map((name) => readFileSync(path.join(seedDir, name), "utf8"))
      .join("\n");
    expect(sql.length).toBeGreaterThan(0);
    for (const row of stableIds) {
      expect(preconId(row.fileName)).toBe(row.id);
      expect(sql).toContain(row.id);
    }
    const forkId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const deck = mapPrecon(entry, sample as MtgjsonDeckFile);
    const one = renderPreconSeed([deck]);
    expect(one).not.toContain(forkId);
    expect(one).toContain(`where c.deck_id = '${deck.id}'`);
    expect(one).toContain("Forks are their own rows");
    expect(sql).not.toContain(forkId);
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

  it("fills a missing Scryfall id from a name and set lookup and reports a miss", async () => {
    const file = structuredClone(sample) as MtgjsonDeckFile;
    const island = file.mainBoard?.find((card) => card.name === "Island");
    island!.identifiers = {};
    island!.setCode = "eoc";
    island!.number = "270";
    const found: PrintingHit = {
      scryfallId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      typeLine: "Basic Land — Island",
      via: "name-set",
    };
    const resolved = await importOnePrecon(entry, file, async (card) => (card.name === "Island" ? found : null));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.deck.cards.find((card) => card.cardName === "Island")?.scryfallId).toBe(found.scryfallId);
    expect(resolved.resolutions.map((row) => row.via)).toContain("name-set");
    const report = renderPreconReport({
      considered: 1,
      decks: [resolved.deck],
      skipped: [],
      resolutions: resolved.resolutions,
    });
    expect(report).toContain("Island");
    expect(report).toContain("name-set");

    const missed = await importOnePrecon(entry, file, async () => null);
    expect(missed.ok).toBe(false);
    if (missed.ok) return;
    expect(missed.skip.cards.some((card) => card.name === "Island" && card.reason.includes("no Scryfall id"))).toBe(true);
    const skipped = renderPreconReport({ considered: 1, decks: [], skipped: [missed.skip], resolutions: [] });
    expect(skipped).toContain("Skipped decks: 1");
    expect(skipped).toContain("Island");
    expect(skipped).toContain("no Scryfall id");
  });

  it("uses a Scryfall type line when the commander text is not a legal type", async () => {
    const file = structuredClone(sample) as MtgjsonDeckFile;
    file.commander = [file.commander![0]!];
    file.commander[0]!.type = "Legendary Artifact — Vehicle";
    const fixed = await importOnePrecon(entry, file, async () => ({
      scryfallId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      typeLine: "Legendary Artifact — Spacecraft",
      via: "set-number",
    }));
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(fixed.deck.commander.typeLine).toBe("Legendary Artifact — Spacecraft");
    expect(fixed.resolutions.some((row) => row.via === "scryfall type line")).toBe(true);

    const skipped = await importOnePrecon(entry, file, async () => null);
    expect(skipped.ok).toBe(false);
    if (skipped.ok) return;
    expect(skipped.skip.reason).toContain("not a legal official type");
    expect(skipped.skip.cards.some((card) => card.name === "Inspirit, Flagship Vessel")).toBe(true);
  });

  it("splits the seed into idempotent batches under the size cap", () => {
    const deck = mapPrecon(entry, sample as MtgjsonDeckFile);
    const second = mapPrecon(
      { ...entry, fileName: "WorldShaper_EOC", name: "World Shaper" },
      { ...(sample as MtgjsonDeckFile), name: "World Shaper" },
    );
    const one = Buffer.byteLength(renderPreconSeed([deck]), "utf8");
    const batches = renderPreconSeedBatches([deck, second], one);
    expect(batches.map((file) => file.fileName)).toEqual(["precons-01.sql", "precons-02.sql"]);
    for (const file of batches) {
      expect(file.sql.startsWith("-- Generated by scripts/import-precons.ts.")).toBe(true);
      expect(file.sql).toContain("begin;");
      expect(file.sql.trimEnd().endsWith("commit;")).toBe(true);
      expect(file.sql).toContain("raise exception");
      expect(file.sql).toContain("on conflict (id) do update");
      expect(Buffer.byteLength(file.sql, "utf8")).toBeLessThanOrEqual(one + 400);
    }
    expect(batches[0]!.sql).toContain(deck.id);
    expect(batches[0]!.sql).not.toContain(second.id);
    expect(batches[1]!.sql).toContain(second.id);
    expect(batches[1]!.sql).not.toContain(deck.id);
  });
});

describe("precon browsing", () => {
  const notes = (code: string, date: string, name: string) =>
    `${name} is an official Commander precon from ${code}, released ${date}.`;
  const deck = (name: string, code: string, date: string, commander: string) => ({
    id: name,
    name,
    notes: notes(code, date, name),
    commander: { cardName: commander },
  });

  it("pages and filters by year, set, and name without returning the whole catalog", () => {
    const decks = [
      deck("Counterpunch", "CMD", "2011-06-17", "Ghave, Guru of Spores"),
      deck("World Shaper", "EOC", "2025-08-01", "Hearthhull, the Worldseed"),
      deck("Counter Intelligence", "EOC", "2025-08-01", "Inspirit, Flagship Vessel"),
      deck("Blame Game", "MKC", "2024-02-09", "Nelly Borca, Impulsive Accuser"),
    ];
    const first = browsePreconDecks(decks, { page: 1, pageSize: 2 });
    expect(first.catalogTotal).toBe(4);
    expect(first.total).toBe(4);
    expect(first.pageCount).toBe(2);
    expect(first.items.map((item) => item.name)).toEqual(["Counter Intelligence", "World Shaper"]);
    expect(first.years).toEqual(["2025", "2024", "2011"]);
    expect(first.sets).toEqual(["CMD", "EOC", "MKC"]);
    const older = browsePreconDecks(decks, { year: "2011", pageSize: 2 });
    expect(older.total).toBe(1);
    expect(older.items.map((item) => item.name)).toEqual(["Counterpunch"]);
    const bySet = browsePreconDecks(decks, { set: "eoc", q: "inspirit" });
    expect(bySet.items.map((item) => item.name)).toEqual(["Counter Intelligence"]);
    expect(preconListHref({ q: "inspirit", year: "2025", set: "eoc", page: 2 })).toBe(
      "/decks?tab=precons&q=inspirit&year=2025&set=EOC&page=2",
    );
    const hits = searchPreconCatalog(
      decks.map((item) => ({
        id: item.id,
        slug: item.id,
        name: item.name,
        setCode: item.notes.match(/from ([A-Z0-9]+)/)![1]!,
        releaseDate: item.notes.match(/released (\d{4}-\d{2}-\d{2})/)![1]!,
        commanderName: item.commander.cardName,
      })),
      "eo",
      1,
    );
    expect(hits.total).toBeGreaterThan(1);
    expect(hits.matches).toHaveLength(1);
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

  it("copies and forks the planeswalker and spacecraft precons onto the user's deck", async () => {
    const specials = [
      ["CounterIntelligence_EOC", "Counter Intelligence", "Inspirit, Flagship Vessel", "Legendary Artifact — Spacecraft"],
      ["WorldShaper_EOC", "World Shaper", "Hearthhull, the Worldseed", "Legendary Artifact — Spacecraft"],
      ["LoreholdSpirit_SOC", "Lorehold Spirit", "Quintorius, History Chaser", "Legendary Planeswalker — Quintorius"],
      ["MultiverseReforged_FRC", "Multiverse Reforged", "Jace, Multiverse Architect", "Legendary Planeswalker — Jace"],
    ] as const;
    db.decks = specials.map(([file, name, cardName, typeLine]) => ({
      id: preconId(file),
      ownerId: null,
      isPrecon: true,
      name,
      format: "commander" as const,
      notes: "",
      visibility: "public" as const,
      allowForks: true,
      forkedFromId: null,
      copiedFromId: null,
      preferredBranchId: null,
      commander: {
        scryfallId: "11111111-2222-4333-8444-555555555555",
        cardName,
        typeLine,
        manaCost: null,
        imageUri: null,
        artUri: null,
        colorIdentity: [],
      },
      colors: [],
      createdAt: T,
      updatedAt: T,
    }));
    db.deckCards = [];
    for (const [file, name, cardName, typeLine] of specials) {
      const id = preconId(file);
      const copyId = await repo.copyDeck(ME, id, `${name} copy`);
      const forkId = await repo.forkDeck(ME, id, `${name} branch`);
      const copy = db.decks.find((deck) => deck.id === copyId);
      const fork = db.decks.find((deck) => deck.id === forkId);
      expect(copy).toMatchObject({
        ownerId: ME,
        isPrecon: false,
        copiedFromId: id,
        commander: { cardName, typeLine },
      });
      expect(fork).toMatchObject({
        ownerId: ME,
        isPrecon: false,
        forkedFromId: id,
        commander: { cardName, typeLine },
      });
      expect(officialCommanderTypeLine(typeLine)).toBe(true);
    }
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
