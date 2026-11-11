import { createHash } from "node:crypto";
import {
  applyPrintingFacts,
  computeDeckStats,
  printingFacts,
  sourcesForDeckStats,
  type DeckStatSource,
  type DeckStats,
  type PrintingFacts,
} from "@/lib/deck-stats";
import { limit, requestIp } from "@/lib/rate-limit";
import { getScryfallCardsById } from "@/lib/scryfall/client";
import { isUuid } from "@/lib/data/validation";

/**
 * Fills mana value, produced mana, and prices from Scryfall, then runs the
 * stats math. The deck page revalidates after a card is added, removed,
 * moved between boards, or reprinted, so the next render sees the new list.
 * Scryfall answers are cached for an hour, in a bounded map keyed by a hash
 * of validated printing ids. A failed or rate-limited lookup still returns
 * stats from the mana costs and type lines already stored on the cards.
 *
 * The cache holds public Scryfall facts only. A private deck never reaches
 * this module: the page calls it after getDeckById.
 */

/** How many distinct printing-sets we keep. Oldest is dropped first. */
export const DECK_STATS_CACHE_MAX = 128;
/** Matches the previous hour-long Next.js cache. */
export const DECK_STATS_CACHE_TTL_MS = 60 * 60 * 1000;
/** Above a normal deck (mainboard plus commander). Larger sets are not fetched. */
export const DECK_STATS_ID_MAX = 250;

type CacheEntry = { facts: PrintingFacts[]; expires: number };

const printingCache = new Map<string, CacheEntry>();

/** Test hook. Production code does not call this. */
export function clearDeckStatsCacheForTests() {
  printingCache.clear();
}

export function deckStatsCacheSizeForTests() {
  return printingCache.size;
}

function printingIds(sources: readonly DeckStatSource[]): string[] {
  const ids = [
    ...new Set(
      sources
        .map((source) => source.scryfallId?.toLowerCase())
        .filter((id): id is string => Boolean(id) && isUuid(id)),
    ),
  ].sort();
  return ids;
}

/** Fixed-length key. Anything that is not a sorted list of UUIDs is refused. */
export function deckStatsCacheKey(ids: readonly string[]): string | null {
  if (ids.length === 0 || ids.length > DECK_STATS_ID_MAX) return null;
  for (const id of ids) {
    if (!isUuid(id) || id !== id.toLowerCase()) return null;
  }
  return createHash("sha256").update(ids.join(",")).digest("hex");
}

function readCache(key: string): PrintingFacts[] | undefined {
  const hit = printingCache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    printingCache.delete(key);
    return undefined;
  }
  // Most recently used stays at the end.
  printingCache.delete(key);
  printingCache.set(key, hit);
  return hit.facts;
}

function writeCache(key: string, facts: PrintingFacts[]) {
  if (printingCache.has(key)) printingCache.delete(key);
  printingCache.set(key, { facts, expires: Date.now() + DECK_STATS_CACHE_TTL_MS });
  while (printingCache.size > DECK_STATS_CACHE_MAX) {
    const oldest = printingCache.keys().next().value;
    if (oldest === undefined) break;
    printingCache.delete(oldest);
  }
}

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
  /** Signed-in viewer, when the page has one. Anonymous views are limited per IP. */
  userId?: string | null;
}): Promise<LoadedDeckStats> {
  const sources = sourcesForDeckStats(input.cards, input.commander);
  const ids = printingIds(sources);
  let facts = new Map<string, PrintingFacts>();
  let scryfallUnavailable = false;
  const key = deckStatsCacheKey(ids);
  if (ids.length > DECK_STATS_ID_MAX) {
    scryfallUnavailable = true;
  } else if (key) {
    const cached = readCache(key);
    if (cached) {
      facts = new Map(cached.map((fact) => [fact.id, fact]));
    } else {
      const ip = await requestIp();
      const allowed = await limit("deck-stats", {
        ip,
        userId: input.userId || `anon:${ip}`,
      });
      if (!allowed.ok) {
        scryfallUnavailable = true;
      } else {
        try {
          const cards = await getScryfallCardsById(ids, { gapMs: 100 });
          const fetched = cards.map((card) => printingFacts(card));
          writeCache(key, fetched);
          facts = new Map(fetched.map((fact) => [fact.id, fact]));
        } catch {
          scryfallUnavailable = true;
        }
      }
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
