"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCollectionCardAction } from "@/lib/actions/collection";
import {
  EMPTY_ADVANCED_FILTERS,
  advancedFiltersActive,
  compileAdvancedQuery,
  type AdvancedFilters,
} from "@/lib/advanced-search";
import { AdvancedFiltersPanel } from "@/components/layout/advanced-filters";
import { scryfallImageOrNull } from "@/lib/data/validation";
import type { CatalogSet } from "@/lib/header-search";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { getCardImage } from "@/lib/scryfall/client";
import {
  SEARCH_RESULT_CAP,
  canLoadMore,
  reachedSearchCap,
  searchPageHref,
  type SearchType,
} from "@/lib/search-results";
import { cn } from "@/lib/utils";

export type SearchResultsQuery = {
  q: string;
  type: SearchType;
  order: string;
  dir: string;
  unique: "" | "prints";
  view: "grid" | "list";
};

type CardHit = {
  id: string;
  name: string;
  typeLine: string;
  setName: string;
  image: string | null;
};

function cardHit(card: ScryfallCard): CardHit | null {
  if (!card.id || !card.name) return null;
  return {
    id: card.id,
    name: card.name,
    typeLine: card.type_line ?? "",
    setName: card.set_name ?? "",
    image: scryfallImageOrNull(getCardImage(card)),
  };
}

export function SearchResults({
  query,
  signedIn,
}: {
  query: SearchResultsQuery;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(query.q);
  const [seenQuery, setSeenQuery] = useState(query.q);
  if (seenQuery !== query.q) {
    setSeenQuery(query.q);
    setDraft(query.q);
  }
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const requestKey = `${query.q}\0${query.type}\0${query.order}\0${query.dir}\0${query.unique}`;
  const [result, setResult] = useState<{
    key: string;
    cards: CardHit[];
    sets: CatalogSet[];
    total: number;
    page: number;
    hasMore: boolean;
    error: string | null;
  }>({ key: "", cards: [], sets: [], total: 0, page: 1, hasMore: false, error: null });

  useEffect(() => {
    const q = query.q.trim();
    if ([...q].length < 2) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      q,
      scope: query.type === "cards" ? "cards" : query.type,
      page: "1",
    });
    if (query.order) params.set("order", query.order);
    if (query.dir) params.set("dir", query.dir);
    if (query.unique) params.set("unique", query.unique);
    fetch(`/api/scryfall/search?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json()) as {
          cards?: ScryfallCard[];
          sets?: CatalogSet[];
          total?: number;
          hasMore?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Search failed");
        if (controller.signal.aborted) return;
        if (query.type === "cards") {
          setResult({
            key: requestKey,
            cards: (data.cards ?? []).map(cardHit).filter((card): card is CardHit => card !== null),
            sets: [],
            total: data.total ?? data.cards?.length ?? 0,
            page: 1,
            hasMore: data.hasMore === true,
            error: null,
          });
        } else {
          setResult({
            key: requestKey,
            cards: [],
            sets: data.sets ?? [],
            total: data.sets?.length ?? 0,
            page: 1,
            hasMore: false,
            error: null,
          });
        }
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError" || controller.signal.aborted) return;
        setResult({
          key: requestKey,
          cards: [],
          sets: [],
          total: 0,
          page: 1,
          hasMore: false,
          error: err instanceof Error ? err.message : "Search failed",
        });
      });
    return () => controller.abort();
  }, [query.dir, query.order, query.q, query.type, query.unique, requestKey]);

  const fresh = result.key === requestKey;
  const cards = fresh ? result.cards : [];
  const sets = fresh ? result.sets : [];
  const total = fresh ? result.total : 0;
  const page = fresh ? result.page : 1;
  const hasMore = fresh ? result.hasMore : false;
  const error = fresh ? result.error : null;
  const loading = [...query.q.trim()].length >= 2 && !fresh;

  function go(
    next: { q?: string; type?: SearchType; view?: "grid" | "list" },
    history: "push" | "replace" = "push",
  ) {
    const href = searchPageHref({
      q: next.q ?? query.q,
      type: next.type ?? query.type,
      order: query.order || undefined,
      dir: query.dir || undefined,
      unique: query.unique || undefined,
      view: next.view ?? query.view,
    });
    if (history === "replace") router.replace(href);
    else router.push(href);
  }

  async function loadMore() {
    const nextPage = page + 1;
    if (!canLoadMore(page, hasMore)) return;
    try {
      const params = new URLSearchParams({
        q: query.q,
        scope: "cards",
        page: String(nextPage),
      });
      if (query.order) params.set("order", query.order);
      if (query.dir) params.set("dir", query.dir);
      if (query.unique) params.set("unique", query.unique);
      const res = await fetch(`/api/scryfall/search?${params}`);
      const data = (await res.json()) as { cards?: ScryfallCard[]; hasMore?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResult((current) => ({
        ...current,
        cards: [
          ...current.cards,
          ...(data.cards ?? []).map(cardHit).filter((card): card is CardHit => card !== null),
        ],
        page: nextPage,
        hasMore: data.hasMore === true,
        error: null,
      }));
    } catch (err) {
      setResult((current) => ({
        ...current,
        error: err instanceof Error ? err.message : "Search failed",
      }));
    }
  }

  const compiled = compileAdvancedQuery("", filters);
  const showCap = query.type === "cards" && reachedSearchCap(page, hasMore);

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if ([...draft.trim()].length >= 2) go({ q: draft.trim(), type: "cards" });
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Search"
            className="h-11 pl-10"
          />
        </div>
        <Button type="submit" className="h-11" aria-label="Search cards">
          Search
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Advanced
        </button>
        <Link href="/browse" className="text-muted-foreground hover:text-foreground">
          Browse decks
        </Link>
      </div>

      {filtersOpen && (
        <div className="mt-3 max-w-xl">
          <AdvancedFiltersPanel name="" filters={filters} onChange={setFilters} />
          {advancedFiltersActive(filters) && compiled.q && (
            <Button
              type="button"
              className="mt-3 h-11"
              onClick={() =>
                router.push(
                  searchPageHref({
                    q: compiled.q,
                    type: "cards",
                    order: compiled.order,
                    dir: compiled.dir,
                    unique: compiled.unique,
                    view: query.view,
                  }),
                )
              }
            >
              Search with these filters
            </Button>
          )}
        </div>
      )}

      {query.q.trim().length >= 2 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Search for &lsquo;{query.q}&rsquo; returned {loading && cards.length === 0 && sets.length === 0 ? "…" : total}{" "}
          results.{" "}
          <Link href="/search" className="font-medium text-primary underline-offset-4 hover:underline">
            Clear
          </Link>
        </p>
      )}

      {query.type === "cards" && query.q.trim().length >= 2 && (
        <div className="mt-4 flex gap-2" role="group" aria-label="Result layout">
          <button
            type="button"
            aria-pressed={query.view === "grid"}
            onClick={() => go({ view: "grid" }, "replace")}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              query.view === "grid" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            <LayoutGrid className="size-5" />
            <span className="sr-only">Grid</span>
          </button>
          <button
            type="button"
            aria-pressed={query.view === "list"}
            onClick={() => go({ view: "list" }, "replace")}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              query.view === "list" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            <List className="size-5" />
            <span className="sr-only">List</span>
          </button>
        </div>
      )}

      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
      {!error && !loading && query.q.trim().length >= 2 && total === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">No matches.</p>
      )}
      {query.q.trim().length < 2 && (
        <p className="mt-6 text-sm text-muted-foreground">Type at least 2 characters.</p>
      )}

      {query.type === "cards" && cards.length > 0 && (
        <ul
          data-testid="search-card-view"
          data-view={query.view}
          className={cn(
            "mt-6",
            query.view === "grid"
              ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
              : "flex flex-col gap-3",
          )}
        >
          {cards.map((card) => (
            <li
              key={card.id}
              className={cn(
                "rounded-xl border border-border/80 bg-card/70 p-3",
                query.view === "list" && "flex items-center gap-3",
              )}
            >
              {card.image ? (
                // Native img keeps loading="lazy" and the Scryfall CDN URL.
                // next/image would rewrite that URL through the optimizer.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.image}
                  alt={card.name}
                  width={query.view === "grid" ? 244 : 122}
                  height={query.view === "grid" ? 340 : 170}
                  loading="lazy"
                  className={cn("h-auto rounded-lg", query.view === "grid" ? "w-full" : "w-20 shrink-0")}
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-background text-sm text-muted-foreground">
                  No image
                </div>
              )}
              <div className="min-w-0">
                <p className="mt-2 truncate font-medium">{card.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[card.setName, card.typeLine].filter(Boolean).join(" · ")}
                </p>
                {signedIn ? (
                  <AddToCollection id={card.id} />
                ) : (
                  <Link
                    href={`/login?next=${encodeURIComponent(
                      searchPageHref({
                        q: query.q,
                        type: query.type,
                        order: query.order || undefined,
                        dir: query.dir || undefined,
                        unique: query.unique || undefined,
                        view: query.view,
                      }),
                    )}`}
                    className="mt-2 inline-flex h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Sign in to add
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {query.type !== "cards" && sets.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2" data-testid="search-set-list">
          {sets.map((set) => (
            <li key={set.id}>
              <Link
                href={searchPageHref({ q: `e:${set.code}`, type: "cards" })}
                className="flex min-h-11 flex-col justify-center rounded-lg border border-border/80 px-3 py-2 hover:bg-secondary"
              >
                <span className="font-medium">{set.name}</span>
                <span className="text-xs text-muted-foreground">
                  {set.code.toUpperCase()} · {set.setType} · {set.cardCount} cards
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {query.type === "cards" && canLoadMore(page, hasMore) && (
        <Button type="button" className="mt-6 h-11" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
      {showCap && (
        <p className="mt-6 text-sm text-muted-foreground">
          Showing the first {SEARCH_RESULT_CAP.toLocaleString("en-US")} cards. Scryfall pages stop at 10.
        </p>
      )}
    </div>
  );
}

function AddToCollection({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="mt-2 h-11"
      disabled={pending || added}
      onClick={() => {
        startTransition(async () => {
          const result = await addCollectionCardAction({ scryfallId: id });
          if (result.error) toast.error(result.error);
          else setAdded(true);
        });
      }}
    >
      {added ? "Added" : "Add to collection"}
    </Button>
  );
}
