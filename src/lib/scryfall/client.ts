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

export async function searchScryfallCards(
  query: string,
  page = 1,
): Promise<{ cards: ScryfallCard[]; total: number; error?: string }> {
  const q = query.trim();
  if (!q) return { cards: [], total: 0 };

  const url = new URL("https://api.scryfall.com/cards/search");
  // Quoted name first so common queries like "sol ring" rank the exact card.
  const searchQuery = q.includes(":") ? q : `name:"${q}" OR ${q}`;
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("page", String(page));
  url.searchParams.set("unique", "cards");

  const res = await fetch(url.toString(), {
    headers: SCRYFALL_HEADERS,
    next: { revalidate: 60 },
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

  const cards = rankCardsByQuery(data.data ?? [], q);
  return {
    cards,
    total: data.total_cards ?? cards.length,
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

export async function getScryfallCard(
  id: string,
): Promise<ScryfallCard | null> {
  const res = await fetch(`https://api.scryfall.com/cards/${id}`, {
    headers: SCRYFALL_HEADERS,
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  return (await res.json()) as ScryfallCard;
}
