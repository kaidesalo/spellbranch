import { unstable_cache } from "next/cache";
import {
  applyPrintingFacts,
  computeDeckStats,
  printingFacts,
  sourcesForDeckStats,
  type DeckStatSource,
  type DeckStats,
  type PrintingFacts,
} from "@/lib/deck-stats";
import { getScryfallCardsById } from "@/lib/scryfall/client";

/**
 * Fills mana value, produced mana, and prices from Scryfall, then runs the
 * stats math. The deck page revalidates after a card is added, removed,
 * moved between boards, or reprinted, so the next render sees the new list.
 * Scryfall answers are cached for an hour. A failed lookup still returns
 * stats from the mana costs and type lines already stored on the cards.
 */

const cachedPrintings = unstable_cache(
  async (joinedIds: string): Promise<PrintingFacts[]> => {
    const ids = joinedIds ? joinedIds.split(",") : [];
    const cards = await getScryfallCardsById(ids, { gapMs: 100 });
    return cards.map((card) => printingFacts(card));
  },
  ["deck-stat-printings"],
  { revalidate: 3600 },
);

export interface LoadedDeckStats extends DeckStats {
  /** Scryfall did not answer. Prices and produced mana are missing. */
  scryfallUnavailable: boolean;
  /** The commander was added to the counted cards. */
  includesCommander: boolean;
}

export async function loadDeckStats(input: {
  cards: readonly DeckStatSource[];
  commander: DeckStatSource | null;
  /** null: no deck colors yet. []: a colorless deck. */
  identity: readonly string[] | null;
}): Promise<LoadedDeckStats> {
  const sources = sourcesForDeckStats(input.cards, input.commander);
  const ids = [
    ...new Set(
      sources
        .map((source) => source.scryfallId?.toLowerCase())
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();
  let facts = new Map<string, PrintingFacts>();
  let scryfallUnavailable = false;
  if (ids.length > 0) {
    try {
      const fetched = await cachedPrintings(ids.join(","));
      facts = new Map(fetched.map((fact) => [fact.id, fact]));
    } catch {
      scryfallUnavailable = true;
    }
  }
  const enriched = sources.map((source) =>
    applyPrintingFacts(source, facts.get(source.scryfallId?.toLowerCase() ?? "")),
  );
  return {
    ...computeDeckStats(enriched, input.identity),
    scryfallUnavailable,
    includesCommander: Boolean(input.commander),
  };
}
