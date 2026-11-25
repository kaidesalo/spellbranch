import { v5 as uuidv5 } from "uuid";
import { isLegalCommanderTypeLine } from "../commander-legality.ts";

/**
 * Official Commander precons. MTGJSON is the only source of card lists.
 * A stable id is uuid v5 of the MTGJSON file name, so re-running the
 * importer upserts the same rows. Every deck whose type is "Commander Deck"
 * is in the catalog; there is no release-date window.
 */
export const PRECON_NAMESPACE = "6f0e2c1a-9b4d-4e7a-8c3f-1d2e3f4a5b6c";

/**
 * Each seed file stays at or under this size. The previous single file of
 * 43 decks was 1.9MB and was loaded in the SQL editor; batches stay smaller
 * than that so each one still fits.
 */
export const PRECON_SEED_MAX_BYTES = 1_500_000;

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
  setCode?: string;
  number?: string;
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

/**
 * Official Commander precons. `from` and `to` (inclusive, YYYY-MM-DD) are
 * optional. Omit them to take every Commander Deck MTGJSON lists.
 */
export function selectCommanderDecks(
  entries: readonly DeckListEntry[],
  from?: string,
  to?: string,
): DeckListEntry[] {
  return entries
    .filter((entry) => {
      if (entry.type !== "Commander Deck") return false;
      if (from && entry.releaseDate < from) return false;
      if (to && entry.releaseDate > to) return false;
      return true;
    })
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.fileName.localeCompare(b.fileName));
}

/** Same rule as isLegalCommanderTypeLine and migration 019's commander CHECK. */
export function officialCommanderTypeLine(typeLine: string): boolean {
  return isLegalCommanderTypeLine(typeLine);
}

export function scryfallImage(scryfallId: string, kind: "normal" | "art_crop" = "normal"): string {
  const id = scryfallId.toLowerCase();
  return `https://cards.scryfall.io/${kind}/front/${id[0]}/${id[1]}/${id}.jpg`;
}

function wubrg(values: readonly string[] | undefined): string[] {
  const present = new Set(values ?? []);
  return WUBRG.filter((color) => present.has(color));
}

function cardIssue(card: MtgjsonCard, where: string): string | null {
  const rawId = card.identifiers?.scryfallId?.trim().toLowerCase() ?? "";
  const label = card.name?.trim() || rawId || "unnamed";
  if (!SCRYFALL_ID.test(rawId)) return `${where} has no Scryfall id (${label})`;
  const quantity = card.count ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return `${where} quantity ${quantity} is outside 1–99 (${label})`;
  }
  const typeLine = (card.type ?? "").trim();
  if (!typeLine || typeLine.length > 200) return `${where} type line is missing or too long (${label})`;
  const name = (card.name ?? "").trim();
  if (!name || name.length > 200) return `${where} card name is missing or too long`;
  const text = card.text?.trim() ? card.text.trim() : null;
  if (text && text.length > 4000) return `${where} oracle text is too long (${name})`;
  const mana = card.manaCost?.trim() ? card.manaCost.trim() : null;
  if (mana && mana.length > 100) return `${where} mana cost is too long (${name})`;
  return null;
}

function mapCard(card: MtgjsonCard, where: string): PreconCard {
  const issue = cardIssue(card, where);
  if (issue) throw new Error(issue);
  const rawId = card.identifiers!.scryfallId!.trim().toLowerCase();
  const quantity = card.count ?? 1;
  const typeLine = (card.type ?? "").trim();
  const name = (card.name ?? "").trim();
  const text = card.text?.trim() ? card.text.trim() : null;
  const mana = card.manaCost?.trim() ? card.manaCost.trim() : null;
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

export type PrintingHit = {
  scryfallId: string;
  typeLine: string | null;
  /** How the printing was found. Shown in the import report. */
  via: "set-number" | "name-set" | "exact-name";
};

export type PrintingLookup = (card: {
  name: string;
  setCode: string;
  number: string;
}) => Promise<PrintingHit | null>;

export type PreconResolution = {
  fileName: string;
  cardName: string;
  where: string;
  scryfallId: string;
  via: string;
};

export type PreconCardSkip = {
  where: string;
  name: string;
  reason: string;
};

export type PreconSkip = {
  fileName: string;
  name: string;
  setCode: string;
  releaseDate: string;
  reason: string;
  cards: PreconCardSkip[];
};

function scryfallIdOf(card: MtgjsonCard): string {
  return card.identifiers?.scryfallId?.trim().toLowerCase() ?? "";
}

function cardLabel(card: MtgjsonCard): string {
  return card.name?.trim() || scryfallIdOf(card) || "unnamed";
}

/**
 * Fill missing Scryfall ids and illegal commander type lines when a lookup
 * can, then map the deck. A deck is skipped whole when any card is still
 * unusable, and every such card is listed. Nothing is dropped quietly.
 */
export async function importOnePrecon(
  entry: DeckListEntry,
  source: MtgjsonDeckFile,
  lookup: PrintingLookup,
): Promise<{ ok: true; deck: PreconDeck; resolutions: PreconResolution[] } | { ok: false; skip: PreconSkip }> {
  const slim = (card: MtgjsonCard): MtgjsonCard => ({
    name: card.name,
    count: card.count,
    type: card.type,
    manaCost: card.manaCost,
    text: card.text,
    colors: card.colors ? [...card.colors] : undefined,
    colorIdentity: card.colorIdentity ? [...card.colorIdentity] : undefined,
    setCode: card.setCode,
    number: card.number,
    identifiers: card.identifiers?.scryfallId ? { scryfallId: card.identifiers.scryfallId } : undefined,
  });
  const file: MtgjsonDeckFile = {
    name: source.name,
    code: source.code,
    type: source.type,
    releaseDate: source.releaseDate,
    commander: (source.commander ?? []).map(slim),
    mainBoard: (source.mainBoard ?? []).map(slim),
  };
  const resolutions: PreconResolution[] = [];
  const commanders = file.commander ?? [];
  const main = file.mainBoard ?? [];

  async function resolve(card: MtgjsonCard, where: string, needsType: boolean) {
    const idOk = SCRYFALL_ID.test(scryfallIdOf(card));
    const typeOk = !needsType || officialCommanderTypeLine((card.type ?? "").trim());
    if (idOk && typeOk) return;
    let hit: PrintingHit | null = null;
    try {
      hit = await lookup({
        name: (card.name ?? "").trim(),
        setCode: (card.setCode ?? entry.code ?? "").trim(),
        number: (card.number ?? "").trim(),
      });
    } catch {
      hit = null;
    }
    if (!idOk) {
      const id = hit?.scryfallId.trim().toLowerCase() ?? "";
      if (SCRYFALL_ID.test(id)) {
        card.identifiers = { ...card.identifiers, scryfallId: id };
        resolutions.push({
          fileName: entry.fileName,
          cardName: cardLabel(card),
          where,
          scryfallId: id,
          via: hit?.via ?? "name-set",
        });
      }
    }
    if (needsType && !officialCommanderTypeLine((card.type ?? "").trim())) {
      const typeLine = hit?.typeLine?.trim() ?? "";
      if (typeLine && typeLine.length <= 200 && officialCommanderTypeLine(typeLine)) {
        card.type = typeLine;
        resolutions.push({
          fileName: entry.fileName,
          cardName: cardLabel(card),
          where,
          scryfallId: scryfallIdOf(card),
          via: "scryfall type line",
        });
      }
    }
  }

  for (let index = 0; index < commanders.length; index += 1) {
    const where = index === 0 ? `${entry.fileName} commander` : `${entry.fileName} commander ${index + 1}`;
    await resolve(commanders[index]!, where, true);
  }
  for (let index = 0; index < main.length; index += 1) {
    await resolve(main[index]!, `${entry.fileName} mainboard ${index + 1}`, false);
  }

  const legalIndex = commanders.findIndex((card) => officialCommanderTypeLine((card.type ?? "").trim()));
  if (legalIndex > 0) {
    const [chosen] = commanders.splice(legalIndex, 1);
    commanders.unshift(chosen!);
    file.commander = commanders;
    resolutions.push({
      fileName: entry.fileName,
      cardName: cardLabel(chosen!),
      where: `${entry.fileName} commander`,
      scryfallId: scryfallIdOf(chosen!),
      via: "legal commander",
    });
  }

  const cards: PreconCardSkip[] = [];
  const positioned: { card: MtgjsonCard; where: string }[] = [
    ...commanders.map((card, index) => ({
      card,
      where: index === 0 ? `${entry.fileName} commander` : `${entry.fileName} commander ${index + 1}`,
    })),
    ...main.map((card, index) => ({ card, where: `${entry.fileName} mainboard ${index + 1}` })),
  ];
  for (const { card, where } of positioned) {
    const issue = cardIssue(card, where);
    if (issue) cards.push({ where, name: cardLabel(card), reason: issue });
  }
  if (commanders.length === 0) {
    cards.push({ where: `${entry.fileName} commander`, name: entry.name, reason: `${entry.fileName} has no commander` });
  }
  const stillIllegal =
    commanders.length > 0 && !commanders.some((card) => officialCommanderTypeLine((card.type ?? "").trim()));
  if (commanders.length > 0 && stillIllegal) {
    for (const card of commanders) {
      const typeLine = (card.type ?? "").trim() || "missing type line";
      cards.push({
        where: `${entry.fileName} commander`,
        name: cardLabel(card),
        reason: `${entry.fileName} commander is not a legal official type (${typeLine})`,
      });
    }
  }

  const skipBase = {
    fileName: entry.fileName,
    name: (file.name ?? entry.name).trim() || entry.fileName,
    setCode: entry.code,
    releaseDate: entry.releaseDate,
  };
  if (cards.length > 0) {
    return {
      ok: false,
      skip: {
        ...skipBase,
        reason: cards.map((card) => card.reason).join("; "),
        cards,
      },
    };
  }

  try {
    return { ok: true, deck: mapPrecon(entry, file), resolutions };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "could not map deck";
    return { ok: false, skip: { ...skipBase, reason, cards: [{ where: entry.fileName, name: skipBase.name, reason }] } };
  }
}

export type PreconImportReport = {
  considered: number;
  decks: readonly PreconDeck[];
  skipped: readonly PreconSkip[];
  resolutions: readonly PreconResolution[];
};

/** Human-readable account of every skipped deck and every lookup that filled a gap. */
export function renderPreconReport(report: PreconImportReport): string {
  const lines = [
    "# Precon import report",
    "",
    "Generated by scripts/import-precons.ts. Not SQL. Do not run this file.",
    "",
    `- Commander decks considered: ${report.considered}`,
    `- Imported: ${report.decks.length}`,
    `- Skipped decks: ${report.skipped.length}`,
    `- Cards or commanders filled in by a lookup: ${report.resolutions.length}`,
    "",
    "## Skipped decks",
    "",
  ];
  if (report.skipped.length === 0) {
    lines.push("None.", "");
  } else {
    for (const skip of report.skipped) {
      lines.push(`### ${skip.name} (${skip.fileName})`, "");
      lines.push(`- Set: ${skip.setCode}`, `- Released: ${skip.releaseDate}`, `- Why: ${skip.reason}`, "");
      if (skip.cards.length > 0) {
        lines.push("Cards:", "");
        for (const card of skip.cards) {
          lines.push(`- ${card.name} (${card.where}): ${card.reason}`);
        }
        lines.push("");
      }
    }
  }
  lines.push("## Resolved by lookup", "");
  if (report.resolutions.length === 0) {
    lines.push("None.", "");
  } else {
    for (const row of report.resolutions) {
      lines.push(`- ${row.fileName} / ${row.cardName} (${row.where}): ${row.via} → ${row.scryfallId}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlArray(values: readonly string[]): string {
  if (values.length === 0) return `'{}'::text[]`;
  return `ARRAY[${values.map(sqlText).join(", ")}]::text[]`;
}

function sqlCard(deckId: string, card: PreconCard): string {
  const mana = card.manaCost ? sqlText(card.manaCost) : "null::text";
  const oracle = card.oracleText ? sqlText(card.oracleText) : "null::text";
  return `(${sqlText(deckId)}::uuid, ${sqlText(card.scryfallId)}, ${sqlText(card.cardName)}, ${sqlText(card.imageUri)}, ${mana}, ${sqlText(card.typeLine)}, ${sqlArray(card.colors)}, ${sqlArray(card.colorIdentity)}, ${oracle}, ${card.quantity}, 'main')`;
}

const PRECON_ROW = "(d.is_precon or d.owner_id is null)";

/** Idempotent seed. Refuses to overwrite a deck a person already owns. */
export function renderPreconSeed(
  decks: readonly PreconDeck[],
  batch?: { batch: number; batches: number },
): string {
  const lines: string[] = [
    "-- Generated by scripts/import-precons.ts. Do not edit by hand.",
    "-- Idempotent. Re-running refreshes these official precons and leaves every other deck alone.",
    "-- Forks are their own rows (a new id, with an owner) and are not modified.",
    batch
      ? `-- Batch ${batch.batch} of ${batch.batches}. Load the numbered seed files in order after the preflight.`
      : "-- Load this file after supabase/checks/precon_preflight.sql.",
    "-- If migrations 018 and 019 are not already applied, apply them first. 011 is reserved.",
    "-- Run as the database owner (SQL editor). Do not run it as anon or authenticated.",
    "begin;",
    "",
    "do $precon_seed$",
    "begin",
    "  if exists (",
    "    select 1",
    "    from public.decks",
    "    where id in (",
    decks.map((deck) => `      ${sqlText(deck.id)}::uuid`).join(",\n"),
    "    )",
    "      and (owner_id is not null or is_precon = false)",
    "  ) then",
    "    raise exception 'precon seed aborted: an id already belongs to a deck with an owner or is_precon = false';",
    "  end if;",
    "end",
    "$precon_seed$;",
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
      `  updated_at = now()`,
      `where decks.is_precon or decks.owner_id is null;`,
      "",
    );
    if (deck.cards.length > 0) {
      lines.push(
        `insert into public.deck_cards (`,
        `  deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors,`,
        `  color_identity, oracle_text, quantity, board`,
        `)`,
        `select v.deck_id, v.scryfall_id, v.card_name, v.image_uri, v.mana_cost, v.type_line, v.colors,`,
        `  v.color_identity, v.oracle_text, v.quantity, v.board`,
        `from (values`,
        deck.cards.map((card) => `  ${sqlCard(deck.id, card)}`).join(",\n"),
        `) as v(deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, color_identity, oracle_text, quantity, board)`,
        `where exists (`,
        `  select 1 from public.decks d`,
        `  where d.id = v.deck_id and ${PRECON_ROW}`,
        `)`,
        `on conflict (deck_id, scryfall_id, board) do update set`,
        `  card_name = excluded.card_name,`,
        `  image_uri = excluded.image_uri,`,
        `  mana_cost = excluded.mana_cost,`,
        `  type_line = excluded.type_line,`,
        `  colors = excluded.colors,`,
        `  color_identity = excluded.color_identity,`,
        `  oracle_text = excluded.oracle_text,`,
        `  quantity = excluded.quantity`,
        `where exists (`,
        `  select 1 from public.decks d`,
        `  where d.id = public.deck_cards.deck_id and ${PRECON_ROW}`,
        `);`,
        "",
        `delete from public.deck_cards as c`,
        `where c.deck_id = ${sqlText(deck.id)}::uuid`,
        `  and exists (`,
        `    select 1 from public.decks d`,
        `    where d.id = c.deck_id and ${PRECON_ROW}`,
        `  )`,
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

/**
 * Split a catalog into numbered, independently idempotent seed files.
 * A single deck that is already over the cap is still written on its own.
 */
export function renderPreconSeedBatches(
  decks: readonly PreconDeck[],
  maxBytes = PRECON_SEED_MAX_BYTES,
): { fileName: string; sql: string }[] {
  const groups: PreconDeck[][] = [];
  let current: PreconDeck[] = [];
  for (const deck of decks) {
    if (current.length === 0) {
      current = [deck];
      continue;
    }
    const trial = renderPreconSeed([...current, deck], { batch: 1, batches: 1 });
    if (Buffer.byteLength(trial, "utf8") > maxBytes) {
      groups.push(current);
      current = [deck];
    } else {
      current.push(deck);
    }
  }
  if (current.length > 0) groups.push(current);
  const batches = groups.length;
  return groups.map((group, index) => {
    const n = index + 1;
    return {
      fileName: `precons-${String(n).padStart(2, "0")}.sql`,
      sql: renderPreconSeed(group, { batch: n, batches }),
    };
  });
}

/** Read-only check for hosted, before migration 018. Zero id rows means the ids are free. */
export function renderPreconPreflight(decks: readonly PreconDeck[]): string {
  return [
    "-- Read-only. Run on the hosted database before the precon seed files.",
    "-- The first query lists decks that already use a precon id.",
    "-- Zero rows means those ids are free (a fresh database, before migration 018).",
    "-- A row with owner_id null is an official precon already loaded; the seed refreshes it in place.",
    "-- A row with owner_id set is a person's deck. Stop and do not load the seed.",
    "-- The second query counts decks whose owner_id is null. Expect 0 before 018.",
    "-- After the original catalog is loaded, that count includes those official precons.",
    "-- SELECT only. No writes.",
    "",
    "select d.id, d.name, d.owner_id",
    "from public.decks d",
    "where d.id in (",
    decks.map((deck) => `  ${sqlText(deck.id)}::uuid`).join(",\n"),
    ")",
    "order by d.id;",
    "",
    "select count(*) filter (where owner_id is null) as null_owner_decks",
    "from public.decks;",
    "",
  ].join("\n");
}
