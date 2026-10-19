"use client";

import { useDeferredValue, useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { Loader2, Plus, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCardImage,
  getCardManaCost,
  getCardOracleText,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import { addCardToDeckAction } from "@/lib/actions/decks";
import { addFavoriteAction } from "@/lib/actions/favorites";

export function CardSearch({
  deckId,
  canEdit,
}: {
  deckId: string;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [cards, setCards] = useState<ScryfallCard[]>([]);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const activeQuery = deferredQuery.trim();
  const showEmptyHint = activeQuery.length >= 2 && !loading && !error && cards.length === 0;

  useEffect(() => {
    if (activeQuery.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/scryfall/search?q=${encodeURIComponent(activeQuery)}`,
          { signal: controller.signal },
        );
        const data = (await res.json()) as {
          cards?: ScryfallCard[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Search failed");
        const next = data.cards ?? [];
        setCards(next);
        setSelected((current) => {
          if (current && next.some((c) => c.id === current.id)) return current;
          return next[0] ?? null;
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setCards([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeQuery]);

  const visibleCards = activeQuery.length < 2 ? [] : cards;
  const visibleSelected =
    activeQuery.length < 2
      ? null
      : selected && visibleCards.some((c) => c.id === selected.id)
        ? selected
        : visibleCards[0] ?? null;

  function addSelected() {
    if (!visibleSelected || !canEdit) return;
    startTransition(async () => {
      const result = await addCardToDeckAction(deckId, {
        scryfallId: visibleSelected.id,
        cardName: visibleSelected.name,
        imageUri: getCardImage(visibleSelected),
        manaCost: getCardManaCost(visibleSelected),
        typeLine: visibleSelected.type_line,
        colors: visibleSelected.colors ?? visibleSelected.color_identity ?? [],
        oracleText: getCardOracleText(visibleSelected),
        quantity: 1,
      });
      if (result.error) toast.error(result.error);
      else toast.success(`Added ${visibleSelected.name}`);
    });
  }

  function favoriteSelected() {
    if (!visibleSelected) return;
    startTransition(async () => {
      const result = await addFavoriteAction({
        scryfallId: visibleSelected.id,
        cardName: visibleSelected.name,
        imageUri: getCardImage(visibleSelected),
        manaCost: getCardManaCost(visibleSelected),
        typeLine: visibleSelected.type_line,
      });
      if (result.error) toast.error(result.error);
      else toast.success(`Saved ${visibleSelected.name} to favorites`);
    });
  }

  const image = visibleSelected ? getCardImage(visibleSelected) : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Scryfall…"
          className="pl-9"
          aria-label="Search cards"
        />
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {showEmptyHint && (
        <p className="text-sm text-muted-foreground">No cards found.</p>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_160px]">
        <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {visibleCards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => setSelected(card)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  visibleSelected?.id === card.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary"
                }`}
              >
                <div className="font-medium">{card.name}</div>
                <div
                  className={`text-xs ${
                    visibleSelected?.id === card.id
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground"
                  }`}
                >
                  {getCardManaCost(card) ?? "—"} · {card.type_line}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-border/70 bg-background/60 p-2">
          {visibleSelected && image ? (
            <Image
              src={image}
              alt={visibleSelected.name}
              width={146}
              height={204}
              className="mx-auto h-auto w-full rounded-lg"
              unoptimized
            />
          ) : (
            <div className="flex aspect-[5/7] items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
              Card preview
            </div>
          )}
          {visibleSelected && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground line-clamp-4">
                {getCardOracleText(visibleSelected) || "No rules text."}
              </p>
              <div className="flex flex-col gap-2">
                {canEdit && (
                  <Button size="sm" onClick={addSelected} disabled={pending}>
                    <Plus data-icon="inline-start" />
                    Add card
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={favoriteSelected}
                  disabled={pending}
                >
                  <Star data-icon="inline-start" />
                  Favorite
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
