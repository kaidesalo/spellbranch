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
import { HEADER_SEARCH_DEBOUNCE_MS, HEADER_SEARCH_MIN_QUERY } from "@/lib/header-search";
import { buildSuggestions, searchPageHref } from "@/lib/search-results";

function useNameSuggestions(query: string) {
  const trimmed = query.trim();
  const active = [...trimmed].length >= HEADER_SEARCH_MIN_QUERY;
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState("");

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: trimmed, scope: "autocomplete" });
        const res = await fetch(`/api/scryfall/search?${params}`, { signal: controller.signal });
        const data = (await res.json()) as { names?: string[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Search failed");
        if (!controller.signal.aborted) {
          setNames(data.names ?? []);
          setLoadedFor(trimmed);
          setLoading(false);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError" || controller.signal.aborted) return;
        setNames([]);
        setLoadedFor(trimmed);
        setError(err instanceof Error ? err.message : "Search failed");
        setLoading(false);
      }
    }, HEADER_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, trimmed]);

  const fresh = loadedFor === trimmed;
  return {
    suggestions: buildSuggestions(trimmed, fresh ? names : []),
    loading: active && (!fresh || loading),
    error: active && fresh ? error : null,
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
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [active, setActive] = useState(0);
  const { suggestions, loading, error } = useNameSuggestions(query);
  const compiled = compileAdvancedQuery(query, filters);
  const cardsHref = [...query.trim()].length >= HEADER_SEARCH_MIN_QUERY
    ? searchPageHref({ q: query.trim(), type: "cards" })
    : "";
  const advancedHref = compiled.q
    ? searchPageHref({
        q: compiled.q,
        type: "cards",
        order: compiled.order,
        dir: compiled.dir,
        unique: compiled.unique,
      })
    : "";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const selectedIndex = suggestions.length === 0 ? 0 : Math.min(active, suggestions.length - 1);
  const activeId = suggestions.length > 0 ? `${listId}-option-${selectedIndex}` : undefined;

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setActive(Math.min(selectedIndex + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setActive(Math.max(selectedIndex - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (suggestions.length > 0) document.getElementById(`${listId}-option-${selectedIndex}`)?.click();
      else document.getElementById("header-search-submit")?.click();
    }
  }

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

      <div className="flex min-h-40 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={inputRef}
              id="header-search-input"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
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
          {cardsHref ? (
            <DialogClose
              render={
                <Link
                  id="header-search-submit"
                  href={cardsHref}
                  aria-label="Search cards"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <Search className="size-5" aria-hidden />
            </DialogClose>
          ) : (
            <button
              type="button"
              id="header-search-submit"
              aria-label="Search cards"
              disabled
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground opacity-50"
            >
              <Search className="size-5" aria-hidden />
            </button>
          )}
        </div>

        {suggestions.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Search suggestions" className="flex flex-col gap-1">
            {suggestions.map((suggestion, index) => {
              const selected = index === selectedIndex;
              return (
                <li key={suggestion.id}>
                  <DialogClose
                    render={
                      <Link
                        id={`${listId}-option-${index}`}
                        href={suggestion.href}
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          "flex min-h-11 items-center rounded-lg px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
                        )}
                      />
                    }
                  >
                    {suggestion.label}
                  </DialogClose>
                </li>
              );
            })}
          </ul>
        )}
        <p className="sr-only" aria-live="polite">
          {suggestions[selectedIndex]?.label ?? ""}
        </p>
        {loading && <p className="text-sm text-muted-foreground">Searching names…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Link
          href="/browse"
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Browse decks
        </Link>

        <AdvancedFiltersPanel name={query} filters={filters} onChange={setFilters} />
        {advancedFiltersActive(filters) && advancedHref && (
          <DialogClose
            render={
              <Link
                href={advancedHref}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            Search with these filters
          </DialogClose>
        )}
      </div>

      <div className="flex justify-end border-t border-border px-4 py-3">
        <DialogClose render={<Button type="button" className="h-11 px-4" />}>Close</DialogClose>
      </div>
    </DialogContent>
  );
}
