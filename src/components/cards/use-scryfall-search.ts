"use client";

import { useDeferredValue, useEffect, useState } from "react";
import type { ScryfallCard } from "@/lib/scryfall/client";

export type ScryfallSearchKind = "cards" | "commander";

/**
 * Debounced Scryfall search through /api/scryfall/search. Shared by the deck
 * card search and the commander picker (kind "commander" asks the route for
 * legendary creatures only).
 */
export function useScryfallSearch(query: string, kind: ScryfallSearchKind = "cards") {
  const deferredQuery = useDeferredValue(query);
  const [cards, setCards] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeQuery = deferredQuery.trim();
  const active = activeQuery.length >= 2;

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: activeQuery });
        if (kind === "commander") params.set("kind", "commander");
        const res = await fetch(`/api/scryfall/search?${params}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          cards?: ScryfallCard[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Search failed");
        setCards(data.cards ?? []);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setCards([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, activeQuery, kind]);

  const visibleCards = active ? cards : [];
  return {
    activeQuery,
    cards: visibleCards,
    loading: active && loading,
    error: active ? error : null,
    showEmptyHint: active && !loading && !error && cards.length === 0,
  };
}

/** The selected card if it's still in the results, else the first result. */
export function pickVisibleSelection(
  cards: ScryfallCard[],
  selected: ScryfallCard | null,
): ScryfallCard | null {
  if (selected && cards.some((c) => c.id === selected.id)) return selected;
  return cards[0] ?? null;
}
