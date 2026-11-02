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
): Promise<{ cards: ScryfallCard[]; total: number; error?: string }> {
  const q = query.trim();
  if (!q) return { cards: [], total: 0 };

  const url = new URL("https://api.scryfall.com/cards/search");
  url.searchParams.set("q", buildSearchQuery(q, kind));
  url.searchParams.set("page", String(page));
  url.searchParams.set("unique", "cards");

  const res = await fetch(url.toString(), {
    headers: SCRYFALL_HEADERS,
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(SCRYFALL_CARD_TIMEOUT_MS),
  });

  if (res.status === 404) {
    return { cards: [], total: 0 };
  }

  const data = (await res.json()) as ScryfallSearchResponse;
  if (!res.ok) {
    return {
      cards: [],
      total: 0,
      error: data.details || "Scryfall search failed",
    };
  }

  const found = data.data ?? [];
  const kept = keep ? found.filter(keep) : found;
  const cards = rankCardsByQuery(kept, q);
  return {
    cards,
    total: keep ? cards.length : (data.total_cards ?? cards.length),
  };
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
