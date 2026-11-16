"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  EMPTY_ADVANCED_FILTERS,
  advancedFiltersActive,
  compileAdvancedQuery,
  type AdvancedFilters,
} from "@/lib/advanced-search";
import { AdvancedFiltersPanel } from "@/components/layout/advanced-filters";
import {
  HEADER_SEARCH_DEBOUNCE_MS,
  HEADER_SEARCH_MIN_QUERY,
  HEADER_SEARCH_SCOPES,
  cardSearchHits,
  catalogSearchHits,
  type CatalogSet,
  type HeaderSearchHit,
  type HeaderSearchScope,
} from "@/lib/header-search";
import type { ScryfallCard } from "@/lib/scryfall/client";

const SCOPE_LABEL: Record<HeaderSearchScope, string> = {
  cards: "Cards",
  precons: "Precons",
  sets: "Sets",
};

function useHeaderSearch(
  query: string,
  scope: HeaderSearchScope,
  enabled: boolean,
  extras: { order?: string; dir?: string; unique?: string },
) {
  const trimmed = query.trim();
  const active = enabled && trimmed.length >= HEADER_SEARCH_MIN_QUERY;
  const requestKey = `${scope}\0${trimmed}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    results: HeaderSearchHit[];
    error: string | null;
    loading: boolean;
  }>({ key: "", results: [], error: null, loading: false });

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSnapshot({ key: requestKey, results: [], error: null, loading: true });
      try {
        const params = new URLSearchParams({ q: trimmed, scope });
        if (extras.order) params.set("order", extras.order);
        if (extras.dir) params.set("dir", extras.dir);
        if (extras.unique) params.set("unique", extras.unique);
        const res = await fetch(`/api/scryfall/search?${params}`, { signal: controller.signal });
        const data = (await res.json()) as {
          cards?: ScryfallCard[];
          sets?: CatalogSet[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Search failed");
        const hits =
          scope === "cards"
            ? cardSearchHits(data.cards ?? [])
            : catalogSearchHits(data.sets ?? [], scope === "precons" ? "precon" : "set");
        if (!controller.signal.aborted) {
          setSnapshot({ key: requestKey, results: hits, error: null, loading: false });
        }
      } catch (err) {
        if ((err as Error).name === "AbortError" || controller.signal.aborted) return;
        setSnapshot({
          key: requestKey,
          results: [],
          error: err instanceof Error ? err.message : "Search failed",
          loading: false,
        });
      }
    }, HEADER_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, extras.dir, extras.order, extras.unique, requestKey, scope, trimmed]);

  const fresh = snapshot.key === requestKey;
  const results = active && fresh ? snapshot.results : [];
  const loading = active && (!fresh || snapshot.loading);
  const error = active && fresh ? snapshot.error : null;
  return {
    results,
    loading,
    error,
    empty: active && fresh && !snapshot.loading && !error && results.length === 0,
    short: enabled && trimmed.length > 0 && trimmed.length < HEADER_SEARCH_MIN_QUERY,
  };
}

export function SearchDialog({ open }: { open: boolean }) {
  if (!open) return null;
  return <SearchDialogBody />;
}

function SearchDialogBody() {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<HeaderSearchScope>("cards");
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [active, setActive] = useState(0);
  const usingFilters = scope === "cards" && advancedFiltersActive(filters);
  const compiled = compileAdvancedQuery(query, filters);
  const requestQuery = usingFilters ? compiled.q : query;
  const { results, loading, error, empty, short } = useHeaderSearch(requestQuery, scope, true, {
    order: usingFilters ? compiled.order : undefined,
    dir: usingFilters ? compiled.dir : undefined,
    unique: usingFilters ? compiled.unique : undefined,
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const selectedIndex = results.length === 0 ? 0 : Math.min(active, results.length - 1);

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(selectedIndex + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(selectedIndex - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById(`${listId}-option-${selectedIndex}`)?.click();
    }
  }

  const activeId = results.length > 0 ? `${listId}-option-${selectedIndex}` : undefined;

  return (
    <DialogContent
      showCloseButton={false}
      initialFocus={inputRef}
      aria-modal="true"
      className="flex max-h-[min(36rem,calc(100dvh-2rem))] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground sm:max-w-xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <DialogTitle className="font-display text-lg font-semibold text-popover-foreground">
          Search Spellbranch
        </DialogTitle>
        <DialogClose
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label="Close search"
              className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
            />
          }
        >
          <span aria-hidden className="text-xl leading-none">
            ×
          </span>
        </DialogClose>
      </div>

      <DialogDescription className="sr-only">
        Search cards, precons, and sets. Browse decks stays available.
      </DialogDescription>

      <div className="border-b border-border px-4 py-3">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            id="header-search-input"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-label="Search for cards, precons, and sets"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search for cards, precons, and sets"
            className="h-11 pl-10"
          />
        </div>
      </div>

      <div className="flex min-h-40 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <div role="radiogroup" aria-label="What to search" className="grid grid-cols-3 gap-1">
          {HEADER_SEARCH_SCOPES.map((item) => {
            const selected = scope === item;
            return (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setScope(item);
                  setActive(0);
                }}
                className={cn(
                  "h-11 rounded-lg label-caps focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {SCOPE_LABEL[item]}
              </button>
            );
          })}
        </div>

        <Link
          href="/browse"
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Browse decks
        </Link>

        {scope === "cards" && (
          <AdvancedFiltersPanel
            name={query}
            filters={filters}
            onChange={(next) => {
              setFilters(next);
              setActive(0);
            }}
          />
        )}

        {short && <p className="text-sm text-muted-foreground">Type at least 2 characters.</p>}
        {loading && <p className="text-sm text-muted-foreground">Searching…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {empty && <p className="text-sm text-muted-foreground">No matches.</p>}
        {!short && !loading && !error && results.length === 0 && !empty && (
          <p className="text-sm text-muted-foreground">Search cards, precons, or sets.</p>
        )}

        {results.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Search results" className="flex flex-col gap-1">
            {results.map((hit, index) => {
              const selected = index === selectedIndex;
              return (
                <li key={`${hit.kind}-${hit.id}`}>
                  <DialogClose
                    render={
                      <Link
                        id={`${listId}-option-${index}`}
                        href={hit.href}
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          "flex min-h-11 flex-col justify-center rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-secondary",
                        )}
                      />
                    }
                  >
                    <span className="truncate font-medium">{hit.title}</span>
                    {hit.subtitle && (
                      <span className={cn("truncate text-xs", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                        {hit.subtitle}
                      </span>
                    )}
                  </DialogClose>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex justify-end border-t border-border px-4 py-3">
        <DialogClose render={<Button type="button" className="h-11 px-4" />}>Close</DialogClose>
      </div>
    </DialogContent>
  );
}
