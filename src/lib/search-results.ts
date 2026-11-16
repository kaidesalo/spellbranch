import { SEARCH_PAGE_MAX, quoteScryfallTerm } from "@/lib/advanced-search";

/** Scryfall returns 175 cards per page. Ten pages is the route cap. */
export const SCRYFALL_PAGE_SIZE = 175;
export const SEARCH_RESULT_CAP = SEARCH_PAGE_MAX * SCRYFALL_PAGE_SIZE;

export const SEARCH_TYPES = ["cards", "precons", "sets"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export type SearchSuggestion = {
  id: string;
  label: string;
  href: string;
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Exact Scryfall name: !"Name", with quotes escaped inside the term. */
export function exactCardQuery(name: string): string {
  const quoted = quoteScryfallTerm(name);
  return quoted ? `!${quoted}` : "";
}

export function searchPageHref(input: {
  q: string;
  type?: SearchType;
  order?: string;
  dir?: string;
  unique?: string;
  view?: "grid" | "list";
}): string {
  const params = new URLSearchParams();
  params.set("q", input.q);
  params.set("type", input.type ?? "cards");
  if (input.order) params.set("order", input.order);
  if (input.dir) params.set("dir", input.dir);
  if (input.unique) params.set("unique", input.unique);
  if (input.view === "list") params.set("view", "list");
  return `/search?${params.toString()}`;
}

export function buildSuggestions(query: string, names: string[]): SearchSuggestion[] {
  const q = query.trim();
  if ([...q].length < 2) return [];
  const scopes: SearchSuggestion[] = (["cards", "precons", "sets"] as const).map((type) => ({
    id: `scope-${type}`,
    label: `${q} in ${type === "cards" ? "Cards" : type === "precons" ? "Precons" : "Sets"}`,
    href: searchPageHref({ q, type }),
  }));
  const seen = new Set<string>();
  const cards: SearchSuggestion[] = [];
  for (const name of names) {
    const key = name.trim().toLowerCase();
    const exact = exactCardQuery(name);
    if (!key || !exact || seen.has(key)) continue;
    seen.add(key);
    cards.push({
      id: `name-${cards.length}`,
      label: name.trim(),
      href: searchPageHref({ q: exact, type: "cards" }),
    });
    if (cards.length >= 8) break;
  }
  return [...scopes, ...cards];
}

export function canLoadMore(page: number, hasMore: boolean): boolean {
  return hasMore && page < SEARCH_PAGE_MAX;
}

export function reachedSearchCap(page: number, hasMore: boolean): boolean {
  return hasMore && page >= SEARCH_PAGE_MAX;
}

export function parseSearchPageQuery(params: {
  q?: string | string[];
  type?: string | string[];
  order?: string | string[];
  dir?: string | string[];
  unique?: string | string[];
  view?: string | string[];
}): {
  q: string;
  type: SearchType;
  order: string;
  dir: string;
  unique: "" | "prints";
  view: "grid" | "list";
} {
  const typeRaw = one(params.type);
  const type = (SEARCH_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as SearchType) : "cards";
  const unique = one(params.unique) === "prints" ? "prints" : "";
  const view = one(params.view) === "list" ? "list" : "grid";
  return {
    q: one(params.q),
    type,
    order: one(params.order),
    dir: one(params.dir),
    unique,
    view,
  };
}
