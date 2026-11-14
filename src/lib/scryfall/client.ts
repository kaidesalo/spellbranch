import { cardLookupKey } from "@/lib/decklist/names";
import { isUuid } from "@/lib/data/validation";
import { filterCatalog, isSetCode, type CatalogSet } from "@/lib/header-search";
import { offeredFinishes } from "@/lib/printing";
import type { CollectionFinish } from "@/lib/collection";

export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: {
      small?: string;
      normal?: string;
      large?: string;
      art_crop?: string;
    };
  }>;
  oracle_id?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  released_at?: string;
  finishes?: string[];
  cmc?: number;
  produced_mana?: string[];
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
  };
}

export interface ScryfallSearchResponse {
  object: string;
  total_cards?: number;
  has_more?: boolean;
  data?: ScryfallCard[];
  details?: string;
}

export function getCardImage(card: ScryfallCard): string | null {
  return (
    card.image_uris?.normal ||
    card.image_uris?.large ||
    card.card_faces?.[0]?.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.large ||
    null
  );
}

export function getCardManaCost(card: ScryfallCard): string | null {
  return card.mana_cost || card.card_faces?.[0]?.mana_cost || null;
}

export function getCardOracleText(card: ScryfallCard): string | null {
  if (card.oracle_text) return card.oracle_text;
  const faces = card.card_faces
    ?.map((f) => f.oracle_text)
    .filter(Boolean)
    .join("\n---\n");
  return faces || null;
}

const SCRYFALL_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Spellbranch/0.1 (https://github.com/spellbranch; mtg deck builder)",
};

/** What a search is for: any card, or a commander pick (legendary creatures). */
export type SearchKind = "card" | "commander";

/** Scryfall filter appended to commander searches. */
export const COMMANDER_SEARCH_FILTER = "t:legendary t:creature";

/**
 * Optional predicate applied to commander results after the search, so the
 * picker only ever lists cards the server would accept even if the user's
 * own query syntax widens the Scryfall match. Injected (rather than imported
 * from @/lib/commander) to avoid a circular import.
 */
type CardFilter = (card: ScryfallCard) => boolean;

export function buildSearchQuery(query: string, kind: SearchKind = "card"): string {
  const q = query.trim();
  // Quoted name first so common queries like "sol ring" rank the exact card.
  const base = q.includes(":") ? q : `name:"${q}" OR ${q}`;
  return kind === "commander" ? `(${base}) ${COMMANDER_SEARCH_FILTER}` : base;
}

export async function searchScryfallCards(
  query: string,
  page = 1,
  kind: SearchKind = "card",
  keep?: CardFilter,
  extra: { unique?: "cards" | "prints"; order?: string; dir?: string } = {},
): Promise<{ cards: ScryfallCard[]; total: number; hasMore?: boolean; error?: string }> {
  const q = query.trim();
  if (!q) return { cards: [], total: 0 };

  const url = new URL("https://api.scryfall.com/cards/search");
  url.searchParams.set("q", buildSearchQuery(q, kind));
  url.searchParams.set("page", String(page));
  url.searchParams.set("unique", extra.unique === "prints" ? "prints" : "cards");
  if (extra.order) url.searchParams.set("order", extra.order);
  if (extra.dir) url.searchParams.set("dir", extra.dir);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: SCRYFALL_HEADERS,
      // Same sandbox as the other Scryfall helpers: do not follow a redirect
      // off api.scryfall.com, and do not send cookies.
      redirect: "error",
      credentials: "omit",
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(SCRYFALL_CARD_TIMEOUT_MS),
    });
  } catch {
    return { cards: [], total: 0, error: "Could not reach Scryfall" };
  }

  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return { cards: [], total: 0 };
  }

  let data: ScryfallSearchResponse;
  try {
    // Same 2 MB cap as the collection / import lookups.
    data = JSON.parse(await readCapped(res, SCRYFALL_COLLECTION_MAX_BYTES)) as ScryfallSearchResponse;
  } catch (err) {
    if (err instanceof ScryfallLookupError && err.kind === "too-large") {
      return {
        cards: [],
        total: 0,
        error: "Scryfall sent an unexpected answer. Try again in a moment.",
      };
    }
    return { cards: [], total: 0, error: "Could not reach Scryfall" };
  }
  if (!res.ok) {
    // Scryfall's details text stays on the server. Callers get a fixed message.
    return {
      cards: [],
      total: 0,
      error: "Scryfall search failed",
    };
  }

  const found = data.data ?? [];
  const kept = keep ? found.filter(keep) : found;
  const cards = rankCardsByQuery(kept, q);
  return {
    cards,
    total: keep ? cards.length : (data.total_cards ?? cards.length),
    hasMore: keep ? false : data.has_more === true,
  };
}

/** Card-name suggestions. The query is only a parameter value, never a URL. */
export async function searchScryfallAutocomplete(
  query: string,
): Promise<{ names: string[]; error?: string }> {
  const q = query.trim();
  if ([...q].length < 2) return { names: [] };
  const url = pinnedScryfallUrl("/cards/autocomplete");
  url.searchParams.set("q", q);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: SCRYFALL_HEADERS,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(SCRYFALL_CARD_TIMEOUT_MS),
    });
  } catch {
    return { names: [], error: "Could not reach Scryfall" };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { names: [], error: "Scryfall search failed" };
  }
  let body: { data?: unknown };
  try {
    body = JSON.parse(await readCapped(res, SCRYFALL_CARD_MAX_BYTES)) as { data?: unknown };
  } catch {
    return { names: [], error: "Could not reach Scryfall" };
  }
  const names: string[] = [];
  if (Array.isArray(body.data)) {
    for (const row of body.data) {
      if (typeof row !== "string") continue;
      const name = row.trim();
      if (!name || [...name].length > 200 || /[\u0000-\u001f\u007f]/.test(name)) continue;
      names.push(name);
      if (names.length >= 8) break;
    }
  }
  return { names };
}

const SETS_MAX_BYTES = 2_000_000;

function catalogSet(row: unknown): CatalogSet | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length > 80) return null;
  if (typeof record.code !== "string" || !isSetCode(record.code)) return null;
  if (typeof record.name !== "string") return null;
  const name = record.name.trim();
  if (!name || name.length > 160) return null;
  if (typeof record.set_type !== "string" || record.set_type.length > 40) return null;
  return {
    id: record.id,
    code: record.code.toLowerCase(),
    name,
    setType: record.set_type,
    releasedAt: typeof record.released_at === "string" ? record.released_at : "",
    cardCount: typeof record.card_count === "number" && record.card_count >= 0 ? record.card_count : 0,
  };
}

const SET_CACHE_MS = 86_400_000;
let setListCache: { at: number; sets: CatalogSet[] } | null = null;

/** Tests need a cold catalog. A failed fetch is never stored. */
export function clearScryfallSetCacheForTests() {
  setListCache = null;
}

/**
 * The full Scryfall set list. A validated 200 is kept in memory for a day.
 * Failures use cache: "no-store" and are not remembered, so a 5xx cannot
 * stick in Next's fetch cache. Set and precon searches filter this list
 * in memory. Same sandbox as the card helpers.
 */
async function loadScryfallSetList(): Promise<{ sets: CatalogSet[]; error?: string }> {
  const now = Date.now();
  if (setListCache && now - setListCache.at < SET_CACHE_MS) {
    return { sets: setListCache.sets };
  }

  const url = pinnedScryfallUrl("/sets");
  let res: Response;
  try {
    res = await fetch(url, {
      headers: SCRYFALL_HEADERS,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(SCRYFALL_CARD_TIMEOUT_MS),
    });
  } catch {
    return { sets: [], error: "Could not reach Scryfall" };
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { sets: [], error: "Scryfall search failed" };
  }

  let body: { data?: unknown };
  try {
    body = JSON.parse(await readCapped(res, SETS_MAX_BYTES)) as { data?: unknown };
  } catch {
    return { sets: [], error: "Could not reach Scryfall" };
  }

  const rows = Array.isArray(body.data) ? body.data : [];
  const sets: CatalogSet[] = [];
  for (const row of rows) {
    const set = catalogSet(row);
    if (set) sets.push(set);
  }
  setListCache = { at: now, sets };
  return { sets };
}

export async function searchScryfallCatalog(
  query: string,
  mode: "sets" | "precons",
): Promise<{ sets: CatalogSet[]; error?: string }> {
  const loaded = await loadScryfallSetList();
  if (loaded.error) return { sets: [], error: loaded.error };
  return { sets: filterCatalog(loaded.sets, query, mode, 100) };
}

function rankCardsByQuery(cards: ScryfallCard[], query: string) {
  const q = query.toLowerCase();
  return [...cards].sort((a, b) => {
    const score = (name: string) => {
      const n = name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      if (n.includes(q)) return 2;
      return 3;
    };
    const byScore = score(a.name) - score(b.name);
    if (byScore !== 0) return byScore;
    return a.name.localeCompare(b.name);
  });
}

/** How long one card lookup may take, end to end (Cipher PR #9 L1). */
export const SCRYFALL_CARD_TIMEOUT_MS = 5000;
/** Largest card body we read; real cards are a few KB (Cipher PR #9 L1). */
export const SCRYFALL_CARD_MAX_BYTES = 1_000_000;

/** Why a card lookup failed when Scryfall didn't simply say 404. */
export class ScryfallLookupError extends Error {
  constructor(
    readonly kind: "timeout" | "too-large" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ScryfallLookupError";
  }
}

/** The body as text, refusing (and cancelling) past maxBytes. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const tooLarge = () => new ScryfallLookupError("too-large", "Scryfall response too large");
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * One card by Scryfall id: null when Scryfall says 404; otherwise throws a
 * ScryfallLookupError when Scryfall can't answer (network, 429, 5xx, bad
 * JSON), takes longer than SCRYFALL_CARD_TIMEOUT_MS, or sends more than
 * SCRYFALL_CARD_MAX_BYTES, so callers don't report "not found".
 * Callers must pass a validated UUID; it is encoded into the path anyway.
 */
export async function getScryfallCard(
  id: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<ScryfallCard | null> {
  const { timeoutMs = SCRYFALL_CARD_TIMEOUT_MS, maxBytes = SCRYFALL_CARD_MAX_BYTES } = opts;
  try {
    // One signal for the request and the body read.
    const res = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(id)}`, {
      headers: SCRYFALL_HEADERS,
      redirect: "error",
      credentials: "omit",
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ScryfallLookupError("unavailable", `Scryfall card lookup failed (${res.status})`);
    }
    return JSON.parse(await readCapped(res, maxBytes)) as ScryfallCard;
  } catch (err) {
    if (err instanceof ScryfallLookupError) throw err;
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ScryfallLookupError("timeout", "Scryfall card lookup timed out");
    }
    throw new ScryfallLookupError("unavailable", "Scryfall card lookup failed");
  }
}

/**
 * How many names one Scryfall collection request accepts. Above this we
 * send another request after SCRYFALL_COLLECTION_GAP_MS.
 */
export const SCRYFALL_COLLECTION_LIMIT = 75;
/** One collection body is many cards; still bounded (Cipher-style cap). */
export const SCRYFALL_COLLECTION_MAX_BYTES = 2_000_000;
export const SCRYFALL_COLLECTION_TIMEOUT_MS = 8_000;
/** Scryfall asks for a short pause between requests. */
export const SCRYFALL_COLLECTION_GAP_MS = 100;
/**
 * Backstop so a caller can't turn one action into an unbounded Scryfall
 * fan-out. Deck import refuses a longer list before it calls this.
 */
export const SCRYFALL_NAME_LOOKUP_MAX = 500;

/**
 * Exact card names, via Scryfall's collection endpoint (batches of 75).
 * Returns one entry per found card. A name Scryfall doesn't know is simply
 * absent — callers match on the card name (and double-faced face names).
 *
 * Sandbox: only https://api.scryfall.com/cards/collection. Timeout, body
 * cap, `redirect: "error"` (no hop to another host), `credentials: "omit"`
 * (no cookies). No other host is contacted. Deck-site URLs are not fetched
 * here or anywhere else.
 */
export async function getScryfallCardsByName(
  names: readonly string[],
  opts: { timeoutMs?: number; maxBytes?: number; gapMs?: number } = {},
): Promise<ScryfallCard[]> {
  const timeoutMs = opts.timeoutMs ?? SCRYFALL_COLLECTION_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? SCRYFALL_COLLECTION_MAX_BYTES;
  const gapMs = opts.gapMs ?? SCRYFALL_COLLECTION_GAP_MS;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string") continue;
    const key = cardLookupKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(name.trim());
  }
  if (unique.length > SCRYFALL_NAME_LOOKUP_MAX) {
    throw new ScryfallLookupError("unavailable", "Too many card names");
  }
  const found: ScryfallCard[] = [];
  for (let i = 0; i < unique.length; i += SCRYFALL_COLLECTION_LIMIT) {
    if (i > 0 && gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    const chunk = unique.slice(i, i + SCRYFALL_COLLECTION_LIMIT);
    found.push(...(await fetchCollection(chunk.map((name) => ({ name })), timeoutMs, maxBytes, "throw")));
  }
  return found;
}

/**
 * Printings by Scryfall id, for deck stats (price, mana value, produced mana).
 * Ids that are not UUIDs are skipped. A 404 (nothing matched) is an empty
 * list. Any other failure throws, same as the name lookup. Host-pinned:
 * only api.scryfall.com, `redirect: "error"`, no cookies.
 */
export async function getScryfallCardsById(
  ids: readonly string[],
  opts: { timeoutMs?: number; maxBytes?: number; gapMs?: number } = {},
): Promise<ScryfallCard[]> {
  const timeoutMs = opts.timeoutMs ?? SCRYFALL_COLLECTION_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? SCRYFALL_COLLECTION_MAX_BYTES;
  const gapMs = opts.gapMs ?? SCRYFALL_COLLECTION_GAP_MS;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !isUuid(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  if (unique.length > SCRYFALL_NAME_LOOKUP_MAX) {
    throw new ScryfallLookupError("unavailable", "Too many cards");
  }
  const found: ScryfallCard[] = [];
  for (let i = 0; i < unique.length; i += SCRYFALL_COLLECTION_LIMIT) {
    if (i > 0 && gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    const chunk = unique.slice(i, i + SCRYFALL_COLLECTION_LIMIT);
    found.push(...(await fetchCollection(chunk.map((id) => ({ id })), timeoutMs, maxBytes, "empty")));
  }
  return found;
}

async function fetchCollection(
  identifiers: Array<{ name: string } | { id: string }>,
  timeoutMs: number,
  maxBytes: number,
  notFound: "throw" | "empty",
): Promise<ScryfallCard[]> {
  try {
    const url = pinnedScryfallUrl("/cards/collection");
    const res = await fetch(url.href, {
      method: "POST",
      headers: { ...SCRYFALL_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers }),
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404 && notFound === "empty") {
      await res.body?.cancel().catch(() => undefined);
      return [];
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ScryfallLookupError("unavailable", `Scryfall collection lookup failed (${res.status})`);
    }
    const body = JSON.parse(await readCapped(res, maxBytes)) as { data?: ScryfallCard[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch (err) {
    if (err instanceof ScryfallLookupError) throw err;
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ScryfallLookupError("timeout", "Scryfall collection lookup timed out");
    }
    throw new ScryfallLookupError("unavailable", "Scryfall collection lookup failed");
  }
}

/** One printing in the change-printing picker. Display fields only. */
export interface CardPrinting {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  releasedAt: string;
  imageUri: string | null;
  finishes: CollectionFinish[];
}

const SCRYFALL_ORIGIN = "https://api.scryfall.com";

function pinnedScryfallUrl(path: string): URL {
  const url = new URL(path, SCRYFALL_ORIGIN);
  if (url.origin !== SCRYFALL_ORIGIN) {
    throw new ScryfallLookupError("unavailable", "Scryfall card lookup failed");
  }
  return url;
}

/** Normal is sharp at a tile; small is the fallback when a printing has no normal image. */
function printingImage(card: ScryfallCard): string | null {
  return (
    card.image_uris?.normal ||
    card.image_uris?.small ||
    card.card_faces?.[0]?.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.small ||
    null
  );
}

/**
 * Every printing of one card. The oracle id is checked to be a UUID and is
 * the only thing placed in the query. Pages are requested on api.scryfall.com
 * directly (`redirect: "error"`); Scryfall's `next_page` URL is ignored so a
 * response cannot send the next fetch somewhere else. At most two pages.
 */
export async function listCardPrintings(oracleId: string): Promise<CardPrinting[]> {
  if (!isUuid(oracleId)) return [];
  const found: ScryfallCard[] = [];
  for (let page = 1; page <= 2; page++) {
    const url = pinnedScryfallUrl("/cards/search");
    url.searchParams.set("q", `oracleid:${oracleId}`);
    url.searchParams.set("unique", "prints");
    url.searchParams.set("order", "released");
    url.searchParams.set("page", String(page));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: SCRYFALL_HEADERS,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(SCRYFALL_CARD_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof ScryfallLookupError) throw err;
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ScryfallLookupError("timeout", "Scryfall card lookup timed out");
      }
      throw new ScryfallLookupError("unavailable", "Scryfall card lookup failed");
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      break;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ScryfallLookupError("unavailable", `Scryfall card lookup failed (${res.status})`);
    }
    const body = JSON.parse(await readCapped(res, SCRYFALL_CARD_MAX_BYTES)) as ScryfallSearchResponse;
    const pageCards = (body.data ?? []).filter((card) => card.oracle_id === oracleId && isUuid(card.id));
    for (const card of pageCards) {
      if (!found.some((row) => row.id === card.id)) found.push(card);
    }
    if (!body.has_more) break;
  }
  const printings = found.map((card) => ({
    id: card.id,
    name: card.name,
    setName: card.set_name?.trim() || card.set?.toUpperCase() || "Unknown set",
    setCode: (card.set ?? "").toUpperCase(),
    collectorNumber: card.collector_number ?? "",
    releasedAt: card.released_at ?? "",
    imageUri: printingImage(card),
    finishes: offeredFinishes(card.finishes),
  }));
  printings.sort((a, b) => {
    const byDate = b.releasedAt.localeCompare(a.releasedAt);
    if (byDate !== 0) return byDate;
    const bySet = a.setName.localeCompare(b.setName, "en");
    if (bySet !== 0) return bySet;
    return a.collectorNumber.localeCompare(b.collectorNumber, "en", { numeric: true });
  });
  return printings;
}
