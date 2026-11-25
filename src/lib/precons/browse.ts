/**
 * Browsing the official precon catalog. Filtering and paging happen in
 * memory over deck rows (name, notes, commander), not over every card.
 */

export const PRECON_PAGE_SIZE = 24;
export const PRECON_SEARCH_LIMIT = 8;

export type PreconFacts = {
  setCode: string;
  releaseDate: string;
  year: string;
};

export type PreconBrowseQuery = {
  q?: string;
  year?: string;
  set?: string;
  page?: number;
  pageSize?: number;
};

export type PreconCatalogEntry = {
  id: string;
  slug: string;
  name: string;
  setCode: string;
  releaseDate: string;
  commanderName: string;
};

const NOTES_FACTS = / from ([A-Za-z0-9]+), released (\d{4}-\d{2}-\d{2})\.$/;

/** Set code and release date stored in the seed notes sentence. */
export function preconFactsFromNotes(notes: string): PreconFacts | null {
  const match = NOTES_FACTS.exec(notes);
  if (!match?.[1] || !match[2]) return null;
  return { setCode: match[1].toUpperCase(), releaseDate: match[2], year: match[2].slice(0, 4) };
}

function pageSizeOf(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) return PRECON_PAGE_SIZE;
  return Math.min(value, 60);
}

function pageOf(value: number | undefined, pageCount: number): number {
  const parsed = Number.isInteger(value) && value !== undefined && value > 0 ? value : 1;
  return Math.min(parsed, pageCount);
}

type Browsable = {
  name: string;
  notes: string;
  commander: { cardName: string } | null;
};

/** Newest release first. Decks without a parsed date sort after dated ones, by name. */
export function browsePreconDecks<T extends Browsable>(
  decks: readonly T[],
  query: PreconBrowseQuery = {},
): {
  items: T[];
  total: number;
  catalogTotal: number;
  page: number;
  pageCount: number;
  years: string[];
  sets: string[];
} {
  const facts = new Map<T, PreconFacts | null>();
  const years = new Set<string>();
  const sets = new Set<string>();
  for (const deck of decks) {
    const fact = preconFactsFromNotes(deck.notes);
    facts.set(deck, fact);
    if (fact) {
      years.add(fact.year);
      sets.add(fact.setCode);
    }
  }
  const q = (query.q ?? "").trim().toLowerCase();
  const year = (query.year ?? "").trim();
  const set = (query.set ?? "").trim().toUpperCase();
  const filtered = decks.filter((deck) => {
    const fact = facts.get(deck) ?? null;
    if (year && fact?.year !== year) return false;
    if (set && fact?.setCode !== set) return false;
    if (!q) return true;
    const commander = deck.commander?.cardName.toLowerCase() ?? "";
    const code = fact?.setCode.toLowerCase() ?? "";
    return deck.name.toLowerCase().includes(q) || commander.includes(q) || code.includes(q);
  });
  const sorted = [...filtered].sort((a, b) => {
    const left = facts.get(a)?.releaseDate ?? "";
    const right = facts.get(b)?.releaseDate ?? "";
    return right.localeCompare(left) || a.name.localeCompare(b.name, "en");
  });
  const pageSize = pageSizeOf(query.pageSize);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = pageOf(query.page, pageCount);
  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total: sorted.length,
    catalogTotal: decks.length,
    page,
    pageCount,
    years: [...years].sort((a, b) => b.localeCompare(a)),
    sets: [...sets].sort((a, b) => a.localeCompare(b)),
  };
}

export function preconListHref(input: { q?: string; year?: string; set?: string; page?: number }): string {
  const params = new URLSearchParams();
  params.set("tab", "precons");
  const q = input.q?.trim();
  const year = input.year?.trim();
  const set = input.set?.trim();
  if (q) params.set("q", q);
  if (year) params.set("year", year);
  if (set) params.set("set", set.toUpperCase());
  if (input.page && input.page > 1) params.set("page", String(input.page));
  return `/decks?${params.toString()}`;
}

/**
 * Header and search-page matches. Ranked, then newest first.
 * `limit` caps the returned matches; `total` is the full hit count.
 */
export function searchPreconCatalog(
  entries: readonly PreconCatalogEntry[],
  query: string,
  limit = PRECON_SEARCH_LIMIT,
): { matches: PreconCatalogEntry[]; total: number } {
  const q = query.trim().toLowerCase();
  if ([...q].length < 2) return { matches: [], total: 0 };
  const scored: { entry: PreconCatalogEntry; score: number }[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const commander = entry.commanderName.toLowerCase();
    const set = entry.setCode.toLowerCase();
    let score = 3;
    if (set === q || name === q || commander === q) score = 0;
    else if (name.startsWith(q) || commander.startsWith(q) || set.startsWith(q)) score = 1;
    else if (name.includes(q) || commander.includes(q) || set.includes(q)) score = 2;
    else continue;
    scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      b.entry.releaseDate.localeCompare(a.entry.releaseDate) ||
      a.entry.name.localeCompare(b.entry.name, "en"),
  );
  return { matches: scored.slice(0, limit).map((row) => row.entry), total: scored.length };
}
