/**
 * Header search: cards, precon products, and sets.
 *
 * Precons are not a separate catalog in this app or in Scryfall. They are
 * Scryfall sets whose set_type is commander, duel_deck, starter, or
 * premium_deck. A result is that product (name, code, date, card count),
 * not the decklist inside it. Commander releases often bundle several
 * decks into one set, so one result can cover more than one 100-card list.
 * Starter includes intro and welcome decks, not only Commander precons.
 */

export const HEADER_SEARCH_DEBOUNCE_MS = 300;
export const HEADER_SEARCH_MIN_QUERY = 2;
export const HEADER_SEARCH_LIMIT = 12;

export const HEADER_SEARCH_SCOPES = ["cards", "precons", "sets"] as const;
export type HeaderSearchScope = (typeof HEADER_SEARCH_SCOPES)[number];

const PRECON_SET_TYPES = ["commander", "duel_deck", "starter", "premium_deck"] as const;
export type PreconSetType = (typeof PRECON_SET_TYPES)[number];

const PRECON_LABEL: Record<PreconSetType, string> = {
  commander: "Commander precon",
  duel_deck: "Duel Deck",
  starter: "Starter deck",
  premium_deck: "Premium deck",
};

export function isPreconSetType(value: string): value is PreconSetType {
  return (PRECON_SET_TYPES as readonly string[]).includes(value);
}

export type CatalogSet = {
  id: string;
  code: string;
  name: string;
  setType: string;
  releasedAt: string;
  cardCount: number;
};

export type HeaderSearchHit = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  kind: "card" | "precon" | "set";
};

const SET_CODE = /^[a-z0-9]{2,10}$/i;

/** Collection's add-card search is the existing card surface. No card page exists. */
export function cardSearchHref(name: string): string {
  const params = new URLSearchParams({
    section: "collection",
    q: name.trim(),
  });
  return `/my-cards?${params.toString()}`;
}

/**
 * Sets and precons open the same add-card search, prefilled with Scryfall's
 * `e:code` filter so the cards from that product show up. `kind` records
 * which result the person chose. There is no set or precon page.
 */
export function catalogSearchHref(code: string, kind: "set" | "precon"): string {
  const params = new URLSearchParams({
    section: "collection",
    q: `e:${code.toLowerCase()}`,
    kind,
  });
  return `/my-cards?${params.toString()}`;
}

export function filterCatalog(
  sets: CatalogSet[],
  query: string,
  mode: "sets" | "precons",
  limit = HEADER_SEARCH_LIMIT,
): CatalogSet[] {
  const q = query.trim().toLowerCase();
  if (q.length < HEADER_SEARCH_MIN_QUERY) return [];
  const matched = sets.filter((set) => {
    if (mode === "precons" && !isPreconSetType(set.setType)) return false;
    return set.name.toLowerCase().includes(q) || set.code.includes(q);
  });
  matched.sort((a, b) => {
    const score = (set: CatalogSet) => {
      if (set.code === q) return 0;
      const name = set.name.toLowerCase();
      if (name.startsWith(q)) return 1;
      if (name.includes(q)) return 2;
      return 3;
    };
    const byScore = score(a) - score(b);
    if (byScore !== 0) return byScore;
    return b.releasedAt.localeCompare(a.releasedAt) || a.name.localeCompare(b.name);
  });
  return matched.slice(0, limit);
}

export function cardSearchHits(
  cards: { id?: string; name?: string; type_line?: string; set_name?: string }[],
): HeaderSearchHit[] {
  const hits: HeaderSearchHit[] = [];
  for (const card of cards) {
    const name = card.name?.trim();
    const id = card.id?.trim();
    if (!name || !id || name.length > 200) continue;
    const subtitle = [card.set_name, card.type_line].filter(Boolean).join(" · ");
    hits.push({
      id,
      title: name,
      subtitle,
      href: cardSearchHref(name),
      kind: "card",
    });
    if (hits.length >= HEADER_SEARCH_LIMIT) break;
  }
  return hits;
}

export function catalogSearchHits(
  sets: CatalogSet[],
  kind: "set" | "precon",
): HeaderSearchHit[] {
  return sets.map((set) => {
    const label = kind === "precon" && isPreconSetType(set.setType) ? PRECON_LABEL[set.setType] : set.setType;
    const when = set.releasedAt || "Undated";
    return {
      id: set.id,
      title: set.name,
      subtitle: `${set.code.toUpperCase()} · ${label} · ${when} · ${set.cardCount} cards`,
      href: catalogSearchHref(set.code, kind),
      kind,
    };
  });
}

export function isSetCode(value: string): boolean {
  return SET_CODE.test(value);
}
