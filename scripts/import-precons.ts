/**
 * Download MTGJSON's Commander Deck lists and write the precon seed.
 *
 *   node --experimental-strip-types scripts/import-precons.ts
 *   node --experimental-strip-types scripts/import-precons.ts --local
 *
 * Does not connect to Supabase. `--local` also writes the generated decks
 * into .data/store.json (gitignored) so the app can browse them without a
 * hosted database. Re-run the import when a new precon releases, then run
 * the preflight and each numbered seed file, in order.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { v5 as uuidv5 } from "uuid";
import {
  PRECON_NAMESPACE,
  importOnePrecon,
  preconId,
  renderPreconPreflight,
  renderPreconReport,
  renderPreconSeedBatches,
  scryfallImage,
  selectCommanderDecks,
  type DeckListEntry,
  type MtgjsonDeckFile,
  type PreconDeck,
  type PreconResolution,
  type PreconSkip,
  type PrintingHit,
} from "../src/lib/precons/import.ts";
import type { PreconCatalogEntry } from "../src/lib/precons/browse.ts";

const LIST_URL = "https://mtgjson.com/api/v5/DeckList.json";
const SEED_DIR = path.join(process.cwd(), "supabase", "seed");
const PREFLIGHT = path.join(process.cwd(), "supabase", "checks", "precon_preflight.sql");
const REPORT = path.join(SEED_DIR, "precons-import-report.md");
const CATALOG = path.join(process.cwd(), "src", "lib", "precons", "catalog.json");
const LOCAL_STORE = path.join(process.cwd(), ".data", "store.json");
const SCRYFALL = "https://api.scryfall.com";

const cache = new Map<string, PrintingHit | null>();
let lastFetch = 0;

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as T;
}

async function pause() {
  const wait = 100 - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastFetch = Date.now();
}

async function scryfallGet(pathname: string): Promise<{ id?: string; type_line?: string; card_faces?: { type_line?: string }[] } | null> {
  await pause();
  const response = await fetch(`${SCRYFALL}${pathname}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Spellbranch/0.1 (precon import; mtg deck builder)",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Scryfall ${pathname} returned ${response.status}`);
  return (await response.json()) as { id?: string; type_line?: string; card_faces?: { type_line?: string }[] };
}

function hitFrom(body: { id?: string; type_line?: string; card_faces?: { type_line?: string }[] }, via: PrintingHit["via"]): PrintingHit | null {
  const id = body.id?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  const typeLine = body.type_line?.trim() || body.card_faces?.[0]?.type_line?.trim() || null;
  return { scryfallId: id, typeLine, via };
}

async function lookupPrinting(card: { name: string; setCode: string; number: string }): Promise<PrintingHit | null> {
  const key = `${card.name}\0${card.setCode}\0${card.number}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const set = card.setCode.toLowerCase();
  let hit: PrintingHit | null = null;
  if (set && card.number) {
    const body = await scryfallGet(`/cards/${encodeURIComponent(set)}/${encodeURIComponent(card.number)}`);
    if (body) hit = hitFrom(body, "set-number");
  }
  if (!hit && card.name && set) {
    const params = new URLSearchParams({ exact: card.name, set });
    const body = await scryfallGet(`/cards/named?${params.toString()}`);
    if (body) hit = hitFrom(body, "name-set");
  }
  if (!hit && card.name) {
    const params = new URLSearchParams({ exact: card.name });
    const body = await scryfallGet(`/cards/named?${params.toString()}`);
    if (body) hit = hitFrom(body, "exact-name");
  }
  cache.set(key, hit);
  return hit;
}

function catalogEntry(deck: PreconDeck): PreconCatalogEntry {
  return {
    id: deck.id,
    slug: deck.slug,
    name: deck.name,
    setCode: deck.setCode,
    releaseDate: deck.releaseDate,
    commanderName: deck.commander.cardName,
  };
}

function localStore(decks: readonly PreconDeck[]) {
  const now = "2026-11-18T00:00:00.000Z";
  return {
    users: [],
    friendships: [],
    favorites: [],
    decks: decks.map((deck) => ({
      id: deck.id,
      ownerId: null,
      isPrecon: true,
      name: deck.name,
      format: "commander",
      notes: deck.notes,
      visibility: "public",
      allowForks: true,
      forkedFromId: null,
      copiedFromId: null,
      preferredBranchId: null,
      commander: {
        scryfallId: deck.commander.scryfallId,
        cardName: deck.commander.cardName,
        typeLine: deck.commander.typeLine,
        manaCost: deck.commander.manaCost,
        imageUri: deck.commander.imageUri,
        artUri: scryfallImage(deck.commander.scryfallId, "art_crop"),
        colorIdentity: deck.commander.colorIdentity,
      },
      colors: deck.colors,
      createdAt: `${deck.releaseDate}T00:00:00.000Z`,
      updatedAt: now,
    })),
    deckCards: decks.flatMap((deck) =>
      deck.cards.map((card) => ({
        id: uuidv5(`${deck.id}:${card.scryfallId}:main`, PRECON_NAMESPACE),
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
        board: "main",
        createdAt: now,
      })),
    ),
    comments: [],
    sessions: {},
  };
}

async function writeSeeds(files: { fileName: string; sql: string }[]) {
  await mkdir(SEED_DIR, { recursive: true });
  const keep = new Set(files.map((file) => file.fileName));
  for (const file of files) {
    await writeFile(path.join(SEED_DIR, file.fileName), file.sql);
  }
  const existing = await readdir(SEED_DIR);
  for (const name of existing) {
    if (name === "precons.sql" || (/^precons-\d+\.sql$/.test(name) && !keep.has(name))) {
      await rm(path.join(SEED_DIR, name));
    }
  }
}

async function main() {
  const list = await loadJson<{ data: DeckListEntry[] }>(LIST_URL);
  const entries = selectCommanderDecks(list.data);
  const decks: PreconDeck[] = [];
  const skipped: PreconSkip[] = [];
  const resolutions: PreconResolution[] = [];
  for (const entry of entries) {
    const file = await loadJson<{ data: MtgjsonDeckFile }>(
      `https://mtgjson.com/api/v5/decks/${encodeURIComponent(entry.fileName)}.json`,
    );
    const outcome = await importOnePrecon(entry, file.data, lookupPrinting);
    if (outcome.ok) {
      decks.push(outcome.deck);
      resolutions.push(...outcome.resolutions);
      if (outcome.deck.id !== preconId(entry.fileName)) {
        throw new Error(`${entry.fileName} id drifted from its file name`);
      }
      process.stdout.write(`${entry.releaseDate} ${entry.code} ${entry.name}\n`);
    } else {
      skipped.push(outcome.skip);
      process.stdout.write(`SKIP ${entry.releaseDate} ${entry.code} ${entry.name}: ${outcome.skip.reason}\n`);
    }
  }
  if (decks.length === 0) throw new Error("No Commander precons imported. Seed files were left unchanged.");

  const files = renderPreconSeedBatches(decks);
  await mkdir(path.dirname(PREFLIGHT), { recursive: true });
  await mkdir(path.dirname(CATALOG), { recursive: true });
  await writeSeeds(files);
  await writeFile(PREFLIGHT, renderPreconPreflight(decks));
  await writeFile(
    REPORT,
    renderPreconReport({ considered: entries.length, decks, skipped, resolutions }),
  );
  const catalog = decks.map(catalogEntry);
  await writeFile(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  if (process.argv.includes("--local")) {
    await mkdir(path.dirname(LOCAL_STORE), { recursive: true });
    await writeFile(LOCAL_STORE, JSON.stringify(localStore(decks)));
    process.stdout.write(`Wrote local store ${LOCAL_STORE}\n`);
  }
  const bytes = files.map((file) => Buffer.byteLength(file.sql, "utf8"));
  process.stdout.write(
    `Imported ${decks.length} of ${entries.length}. Skipped ${skipped.length}. Resolved ${resolutions.length}.\n`,
  );
  files.forEach((file, index) => {
    process.stdout.write(`${file.fileName} ${(bytes[index]! / 1024 / 1024).toFixed(2)} MB\n`);
  });
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("import-precons.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
