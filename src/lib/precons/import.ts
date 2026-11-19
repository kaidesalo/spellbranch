import { v5 as uuidv5 } from "uuid";

/**
 * Official Commander precons. MTGJSON is the only source of card lists.
 * A stable id is uuid v5 of the MTGJSON file name, so re-running the
 * importer upserts the same rows.
 */
export const PRECON_NAMESPACE = "6f0e2c1a-9b4d-4e7a-8c3f-1d2e3f4a5b6c";

/** 18 months before 18 Nov 2026, inclusive. */
export const PRECON_RELEASED_FROM = "2025-05-18";
export const PRECON_RELEASED_TO = "2026-11-18";

const WUBRG = ["W", "U", "B", "R", "G"] as const;
const SCRYFALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DeckListEntry = {
  code: string;
  fileName: string;
  name: string;
  releaseDate: string;
  type: string;
};

export type MtgjsonCard = {
  name?: string;
  count?: number;
  type?: string;
  manaCost?: string | null;
  text?: string | null;
  colors?: string[];
  colorIdentity?: string[];
  identifiers?: { scryfallId?: string };
};

export type MtgjsonDeckFile = {
  name?: string;
  code?: string;
  type?: string;
  releaseDate?: string;
  commander?: MtgjsonCard[];
  mainBoard?: MtgjsonCard[];
};

export type PreconCard = {
  scryfallId: string;
  cardName: string;
  manaCost: string | null;
  typeLine: string;
  oracleText: string | null;
  colors: string[];
  colorIdentity: string[];
  quantity: number;
  imageUri: string;
};

export type PreconDeck = {
  id: string;
  slug: string;
  setCode: string;
  releaseDate: string;
  name: string;
  notes: string;
  commander: PreconCard;
  cards: PreconCard[];
  colors: string[];
};

export function preconId(fileName: string): string {
  return uuidv5(fileName, PRECON_NAMESPACE);
}

export function selectCommanderDecks(
  entries: readonly DeckListEntry[],
  from = PRECON_RELEASED_FROM,
  to = PRECON_RELEASED_TO,
): DeckListEntry[] {
  return entries
    .filter((entry) => entry.type === "Commander Deck" && entry.releaseDate >= from && entry.releaseDate <= to)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.fileName.localeCompare(b.fileName));
}

/** Front face may be a legendary creature, planeswalker, or spacecraft. */
export function officialCommanderTypeLine(typeLine: string): boolean {
  const front = typeLine.split("//")[0] ?? "";
  const types = front.split("—")[0] ?? "";
  const subtypes = front.split("—")[1] ?? "";
  const word = (part: string, token: string) => new RegExp(`(^|\\s)${token}(\\s|$)`).test(part);
  if (!word(types, "Legendary")) return false;
  if (word(types, "Creature") || word(types, "Planeswalker")) return true;
  return word(types, "Artifact") && word(subtypes, "Spacecraft");
}

export function scryfallImage(scryfallId: string, kind: "normal" | "art_crop" = "normal"): string {
  const id = scryfallId.toLowerCase();
  return `https://cards.scryfall.io/${kind}/front/${id[0]}/${id[1]}/${id}.jpg`;
}

function wubrg(values: readonly string[] | undefined): string[] {
  const present = new Set(values ?? []);
  return WUBRG.filter((color) => present.has(color));
}

function mapCard(card: MtgjsonCard, where: string): PreconCard {
  const rawId = card.identifiers?.scryfallId?.trim().toLowerCase() ?? "";
  if (!SCRYFALL_ID.test(rawId)) {
    throw new Error(`${where} has no Scryfall id (${card.name ?? "unnamed"})`);
  }
  const quantity = card.count ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new Error(`${where} quantity ${quantity} is outside 1–99 (${card.name ?? rawId})`);
  }
  const typeLine = (card.type ?? "").trim();
  if (!typeLine || typeLine.length > 200) {
    throw new Error(`${where} type line is missing or too long (${card.name ?? rawId})`);
  }
  const name = (card.name ?? "").trim();
  if (!name || name.length > 200) throw new Error(`${where} card name is missing or too long`);
  const text = card.text?.trim() ? card.text.trim() : null;
  if (text && text.length > 4000) throw new Error(`${where} oracle text is too long (${name})`);
  const mana = card.manaCost?.trim() ? card.manaCost.trim() : null;
  if (mana && mana.length > 100) throw new Error(`${where} mana cost is too long (${name})`);
  return {
    scryfallId: rawId,
    cardName: name,
    manaCost: mana,
    typeLine,
    oracleText: text,
    colors: wubrg(card.colors),
    colorIdentity: wubrg(card.colorIdentity ?? card.colors),
    quantity,
    imageUri: scryfallImage(rawId),
  };
}

function mergeCopies(cards: PreconCard[]): PreconCard[] {
  const byId = new Map<string, PreconCard>();
  for (const card of cards) {
    const existing = byId.get(card.scryfallId);
    if (!existing) {
      byId.set(card.scryfallId, { ...card });
      continue;
    }
    const quantity = existing.quantity + card.quantity;
    if (quantity > 99) throw new Error(`${card.cardName} adds up to more than 99 copies`);
    existing.quantity = quantity;
  }
  return [...byId.values()].sort((a, b) => a.cardName.localeCompare(b.cardName, "en") || a.scryfallId.localeCompare(b.scryfallId));
}

export function mapPrecon(entry: DeckListEntry, file: MtgjsonDeckFile): PreconDeck {
  const commanders = file.commander ?? [];
  if (commanders.length === 0) throw new Error(`${entry.fileName} has no commander`);
  const commander = mapCard(commanders[0]!, `${entry.fileName} commander`);
  if (!officialCommanderTypeLine(commander.typeLine)) {
    throw new Error(`${entry.fileName} commander is not a legal official type (${commander.typeLine})`);
  }
  const extras = commanders.slice(1).map((card, index) => mapCard(card, `${entry.fileName} commander ${index + 2}`));
  const main = (file.mainBoard ?? []).map((card, index) => mapCard(card, `${entry.fileName} mainboard ${index + 1}`));
  const cards = mergeCopies([...main, ...extras.filter((card) => card.scryfallId !== commander.scryfallId)]);
  const name = (file.name ?? entry.name).trim();
  if (!name || name.length > 80) throw new Error(`${entry.fileName} name is missing or longer than 80 characters`);
  const notes = `${name} is an official Commander precon from ${entry.code}, released ${entry.releaseDate}.`;
  const colors = wubrg([
    ...commander.colorIdentity,
    ...cards.flatMap((card) => card.colorIdentity),
  ]);
  return {
    id: preconId(entry.fileName),
    slug: entry.fileName,
    setCode: entry.code,
    releaseDate: entry.releaseDate,
    name,
    notes,
    commander,
    cards,
    colors,
  };
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlArray(values: readonly string[]): string {
  if (values.length === 0) return `'{}'::text[]`;
  return `ARRAY[${values.map(sqlText).join(", ")}]::text[]`;
}

function sqlCard(deckId: string, card: PreconCard): string {
  return `(${sqlText(deckId)}::uuid, ${sqlText(card.scryfallId)}, ${sqlText(card.cardName)}, ${sqlText(card.imageUri)}, ${
    card.manaCost ? sqlText(card.manaCost) : "null"
  }, ${sqlText(card.typeLine)}, ${sqlArray(card.colors)}, ${sqlArray(card.colorIdentity)}, ${
    card.oracleText ? sqlText(card.oracleText) : "null"
  }, ${card.quantity}, 'main')`;
}

/** Idempotent seed. Upserts by precon id and by (deck, printing, board). */
export function renderPreconSeed(decks: readonly PreconDeck[]): string {
  const lines: string[] = [
    "-- Generated by scripts/import-precons.ts. Do not edit by hand.",
    "-- Run after supabase/migrations/018_precons.sql, as the database owner",
    "-- (SQL editor). Do not run it as anon or authenticated.",
    "begin;",
    "",
  ];
  for (const deck of decks) {
    const commander = deck.commander;
    lines.push(
      `insert into public.decks (`,
      `  id, owner_id, name, format, notes, visibility, allow_forks, is_precon,`,
      `  commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost,`,
      `  commander_image_uri, commander_art_uri, commander_color_identity, colors`,
      `) values (`,
      `  ${sqlText(deck.id)}::uuid, null, ${sqlText(deck.name)}, 'commander', ${sqlText(deck.notes)}, 'public', true, true,`,
      `  ${sqlText(commander.scryfallId)}, ${sqlText(commander.cardName)}, ${sqlText(commander.typeLine)}, ${
        commander.manaCost ? sqlText(commander.manaCost) : "null"
      },`,
      `  ${sqlText(scryfallImage(commander.scryfallId))}, ${sqlText(scryfallImage(commander.scryfallId, "art_crop"))}, ${sqlArray(commander.colorIdentity)}, ${sqlArray(deck.colors)}`,
      `) on conflict (id) do update set`,
      `  owner_id = excluded.owner_id,`,
      `  name = excluded.name,`,
      `  format = excluded.format,`,
      `  notes = excluded.notes,`,
      `  visibility = excluded.visibility,`,
      `  allow_forks = excluded.allow_forks,`,
      `  is_precon = excluded.is_precon,`,
      `  commander_scryfall_id = excluded.commander_scryfall_id,`,
      `  commander_name = excluded.commander_name,`,
      `  commander_type_line = excluded.commander_type_line,`,
      `  commander_mana_cost = excluded.commander_mana_cost,`,
      `  commander_image_uri = excluded.commander_image_uri,`,
      `  commander_art_uri = excluded.commander_art_uri,`,
      `  commander_color_identity = excluded.commander_color_identity,`,
      `  colors = excluded.colors,`,
      `  updated_at = now();`,
      "",
    );
    if (deck.cards.length > 0) {
      lines.push(
        `insert into public.deck_cards (`,
        `  deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,`,
        `  color_identity, oracle_text, quantity, board`,
        `) values`,
        deck.cards.map((card) => `  ${sqlCard(deck.id, card)}`).join(",\n"),
        `on conflict (deck_id, scryfall_id, board) do update set`,
        `  card_name = excluded.card_name,`,
        `  image_uri = excluded.image_uri,`,
        `  mana_cost = excluded.mana_cost,`,
        `  type_line = excluded.type_line,`,
        `  colors = excluded.colors,`,
        `  color_identity = excluded.color_identity,`,
        `  oracle_text = excluded.oracle_text,`,
        `  quantity = excluded.quantity;`,
        "",
        `delete from public.deck_cards as c`,
        `where c.deck_id = ${sqlText(deck.id)}::uuid`,
        `  and (c.scryfall_id, c.board) not in (`,
        deck.cards.map((card) => `    (${sqlText(card.scryfallId)}, 'main')`).join(",\n"),
        `  );`,
        "",
      );
    }
  }
  lines.push("commit;");
  lines.push("");
  return lines.join("\n");
}
