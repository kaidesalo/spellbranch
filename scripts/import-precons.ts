/**
 * Download MTGJSON's Commander Deck lists and write supabase/seed/precons.sql.
 *
 *   node --experimental-strip-types scripts/import-precons.ts
 *
 * Does not connect to Supabase. Re-run it when a new precon set releases,
 * then apply the seed in the SQL editor after migration 018.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  mapPrecon,
  renderPreconSeed,
  selectCommanderDecks,
  type DeckListEntry,
  type MtgjsonDeckFile,
} from "../src/lib/precons/import.ts";

const LIST_URL = "https://mtgjson.com/api/v5/DeckList.json";
const OUT = path.join(process.cwd(), "supabase", "seed", "precons.sql");

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as T;
}

async function main() {
  const list = await loadJson<{ data: DeckListEntry[] }>(LIST_URL);
  const entries = selectCommanderDecks(list.data);
  const decks = [];
  for (const entry of entries) {
    const file = await loadJson<{ data: MtgjsonDeckFile }>(
      `https://mtgjson.com/api/v5/decks/${encodeURIComponent(entry.fileName)}.json`,
    );
    decks.push(mapPrecon(entry, file.data));
    process.stdout.write(`${entry.releaseDate} ${entry.code} ${entry.name}\n`);
  }
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, renderPreconSeed(decks));
  process.stdout.write(`Wrote ${decks.length} precons to ${OUT}\n`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("import-precons.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
