import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

const fetchCards = vi.fn(async (ids: string[]) =>
  ids.map((id) => ({
    id,
    cmc: 1,
    mana_cost: "{R}",
    prices: { usd: "0.25" },
  })),
);

vi.mock("@/lib/scryfall/client", () => ({
  getScryfallCardsById: (...args: unknown[]) => fetchCards(...(args as [string[]])),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.8" }) }));

const {
  DECK_STATS_CACHE_MAX,
  DECK_STATS_ID_MAX,
  clearDeckStatsCacheForTests,
  deckStatsCacheKey,
  deckStatsCacheSizeForTests,
  loadDeckStats,
} = await import("@/lib/deck-stats-load");

function uuid(n: number) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function source(id: string) {
  return {
    cardName: "Bolt",
    scryfallId: id,
    quantity: 1,
    board: "main" as const,
    manaCost: "{R}",
    typeLine: "Instant",
    colorIdentity: ["R"],
  };
}

beforeEach(() => {
  fetchCards.mockClear();
  clearDeckStatsCacheForTests();
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  vi.stubEnv("SPELLBRANCH_RATE_LIMIT_SECRET", "x".repeat(32));
  setRateLimitStoreForTests({ hit: async () => ({ allowed: true, retryAfterSec: 0 }) });
});

describe("deck-stats printing cache", () => {
  it("hashes a sorted list of lowercase uuids and refuses anything else", () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const key = deckStatsCacheKey([id]);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(deckStatsCacheKey([id.toUpperCase()])).toBeNull();
    expect(deckStatsCacheKey(["not-a-uuid"])).toBeNull();
    expect(deckStatsCacheKey([])).toBeNull();
    expect(deckStatsCacheKey(Array.from({ length: DECK_STATS_ID_MAX + 1 }, (_, i) => uuid(i + 1)))).toBeNull();
  });

  it("fetches once per printing set and does not follow a cache hit", async () => {
    const id = uuid(1);
    const first = await loadDeckStats({ cards: [source(id)], commander: null, identity: ["R"], userId: "user-1" });
    const second = await loadDeckStats({ cards: [source(id)], commander: null, identity: ["R"], userId: "user-1" });
    expect(fetchCards).toHaveBeenCalledTimes(1);
    expect(first.scryfallUnavailable).toBe(false);
    expect(second.scryfallUnavailable).toBe(false);
    expect(second.priceUsd).toBeCloseTo(0.25);
  });

  it("drops ids that are not uuids and does not call Scryfall for them", async () => {
    const stats = await loadDeckStats({
      cards: [source("not-a-uuid")],
      commander: null,
      identity: ["R"],
      userId: "user-1",
    });
    expect(fetchCards).not.toHaveBeenCalled();
    expect(stats.scryfallUnavailable).toBe(false);
  });

  it("does not fetch a printing set larger than the cap", async () => {
    const cards = Array.from({ length: DECK_STATS_ID_MAX + 1 }, (_, i) => source(uuid(i + 1)));
    const stats = await loadDeckStats({ cards, commander: null, identity: null, userId: "user-1" });
    expect(fetchCards).not.toHaveBeenCalled();
    expect(stats.scryfallUnavailable).toBe(true);
  });

  it("keeps at most DECK_STATS_CACHE_MAX keys and refetches an evicted set", async () => {
    for (let i = 1; i <= DECK_STATS_CACHE_MAX + 1; i++) {
      await loadDeckStats({ cards: [source(uuid(i))], commander: null, identity: null, userId: "user-1" });
    }
    expect(deckStatsCacheSizeForTests()).toBe(DECK_STATS_CACHE_MAX);
    expect(fetchCards).toHaveBeenCalledTimes(DECK_STATS_CACHE_MAX + 1);
    await loadDeckStats({ cards: [source(uuid(1))], commander: null, identity: null, userId: "user-1" });
    expect(fetchCards).toHaveBeenCalledTimes(DECK_STATS_CACHE_MAX + 2);
    expect(deckStatsCacheSizeForTests()).toBe(DECK_STATS_CACHE_MAX);
  });

  it("rate-limits cache misses per user and still returns stats", async () => {
    setRateLimitStoreForTests(new MemoryStore(() => 1_700_000_000_000));
    for (let i = 1; i <= 40; i++) {
      const stats = await loadDeckStats({
        cards: [source(uuid(i))],
        commander: null,
        identity: null,
        userId: "user-1",
      });
      expect(stats.scryfallUnavailable).toBe(false);
    }
    expect(fetchCards).toHaveBeenCalledTimes(40);
    const blocked = await loadDeckStats({
      cards: [source(uuid(41))],
      commander: null,
      identity: null,
      userId: "user-1",
    });
    expect(blocked.scryfallUnavailable).toBe(true);
    expect(fetchCards).toHaveBeenCalledTimes(40);
    const hit = await loadDeckStats({
      cards: [source(uuid(1))],
      commander: null,
      identity: null,
      userId: "user-1",
    });
    expect(hit.scryfallUnavailable).toBe(false);
    expect(fetchCards).toHaveBeenCalledTimes(40);
  });
});
