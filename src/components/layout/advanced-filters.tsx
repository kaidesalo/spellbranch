"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  COLOR_MODES,
  COLOR_PIPS,
  FORMAT_FILTERS,
  MANA_OPS,
  RARITY_FILTERS,
  SORT_DIRECTIONS,
  SORT_ORDERS,
  compileAdvancedQuery,
  toggleColor,
  toggleFormat,
  toggleRarity,
  type AdvancedFilters,
  type ColorMode,
  type ManaOp,
  type SortDirection,
  type SortOrder,
} from "@/lib/advanced-search";

const FORMAT_LABEL: Record<(typeof FORMAT_FILTERS)[number], string> = {
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  commander: "Commander",
  oathbreaker: "Oathbreaker",
  brawl: "Brawl",
  timeless: "Timeless",
  historic: "Historic",
  pauper: "Pauper",
};

const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  exactly: "Exactly these",
  including: "Including these",
  atMost: "At most these",
};

const RARITY_LABEL: Record<(typeof RARITY_FILTERS)[number], string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
  special: "Special",
};

const chipClass =
  "min-h-11 rounded-lg px-3 label-caps focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        chipClass,
        pressed
          ? "bg-primary text-primary-foreground"
          : "bg-secondary/60 text-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border/80 bg-background/40">
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {title}
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

export function AdvancedFiltersPanel({
  name,
  filters,
  onChange,
}: {
  name: string;
  filters: AdvancedFilters;
  onChange: (filters: AdvancedFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [oracleDraft, setOracleDraft] = useState("");
  const compiled = compileAdvancedQuery(name, filters);
  const panelId = "advanced-card-filters";

  function addOracle() {
    const chip = oracleDraft.trim();
    if (!chip || filters.oracle.some((item) => item.toLowerCase() === chip.toLowerCase())) return;
    onChange({ ...filters, oracle: [...filters.oracle, chip] });
    setOracleDraft("");
  }

  return (
    <div className="rounded-xl border border-border/80">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between px-3 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Advanced filters
        <span aria-hidden className="text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <div>
            <div id="scryfall-query-label" className="text-xs font-medium text-muted-foreground">
              Scryfall query
            </div>
            <output
              aria-labelledby="scryfall-query-label"
              className="mt-1 block min-h-11 overflow-x-auto rounded-lg border border-border bg-background/70 px-3 py-2 font-mono text-sm text-foreground"
            >
              {compiled.display || "Add filters to build a query."}
            </output>
          </div>

          <Section title="Format legality">
            <fieldset>
              <legend className="sr-only">Format legality</legend>
              <div className="flex flex-wrap gap-2">
                {FORMAT_FILTERS.map((format) => (
                  <Chip
                    key={format}
                    pressed={filters.formats.includes(format)}
                    onClick={() => onChange(toggleFormat(filters, format))}
                  >
                    {FORMAT_LABEL[format]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </Section>

          <Section title="Colors">
            <fieldset>
              <legend className="sr-only">Colors</legend>
              <div className="flex flex-wrap gap-2">
                {COLOR_PIPS.map((pip) => {
                  const pressed = filters.colors.includes(pip.id);
                  return (
                    <button
                      key={pip.id}
                      type="button"
                      aria-pressed={pressed}
                      aria-label={pip.label}
                      onClick={() => onChange(toggleColor(filters, pip.id))}
                      className={cn(
                        "inline-flex size-11 items-center justify-center rounded-full border text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        pressed
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-foreground hover:bg-secondary",
                      )}
                    >
                      {pip.id.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div role="radiogroup" aria-label="Color match" className="mt-3 flex flex-wrap gap-2">
              {COLOR_MODES.map((mode) => {
                const selected = filters.colorMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange({ ...filters, colorMode: mode })}
                    className={cn(
                      chipClass,
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/60 text-foreground hover:bg-secondary",
                    )}
                  >
                    {COLOR_MODE_LABEL[mode]}
                  </button>
                );
              })}
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={filters.colorIdentity}
                onChange={(event) => onChange({ ...filters, colorIdentity: event.target.checked })}
              />
              Color identity
            </label>
          </Section>

          <Section title="Type line">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Type line</span>
              <Input
                value={filters.typeLine}
                onChange={(event) => onChange({ ...filters, typeLine: event.target.value })}
                placeholder="Legendary Creature"
                className="h-11"
              />
            </label>
          </Section>

          <Section title="Oracle text">
            <div className="flex gap-2">
              <Input
                aria-label="Oracle text"
                value={oracleDraft}
                onChange={(event) => setOracleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addOracle();
                  }
                }}
                placeholder="Draw a card"
                className="h-11"
              />
              <Button type="button" className="h-11 shrink-0" onClick={addOracle}>
                Add
              </Button>
            </div>
            {filters.oracle.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Oracle text chips">
                {filters.oracle.map((chip) => (
                  <li key={chip}>
                    <button
                      type="button"
                      className={cn(chipClass, "bg-primary text-primary-foreground")}
                      aria-label={`Remove oracle text ${chip}`}
                      onClick={() =>
                        onChange({ ...filters, oracle: filters.oracle.filter((item) => item !== chip) })
                      }
                    >
                      {chip}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Mana value">
            <div className="flex gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Operator</span>
                <select
                  aria-label="Mana value operator"
                  className="h-11 rounded-lg border border-input bg-transparent px-2"
                  value={filters.manaOp}
                  onChange={(event) => onChange({ ...filters, manaOp: event.target.value as ManaOp })}
                >
                  {MANA_OPS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Mana value</span>
                <Input
                  inputMode="numeric"
                  value={filters.manaValue}
                  onChange={(event) => onChange({ ...filters, manaValue: event.target.value })}
                  placeholder="3"
                  className="h-11"
                />
              </label>
            </div>
          </Section>

          <Section title="Rarity">
            <fieldset>
              <legend className="sr-only">Rarity</legend>
              <div className="flex flex-wrap gap-2">
                {RARITY_FILTERS.map((rarity) => (
                  <Chip
                    key={rarity}
                    pressed={filters.rarities.includes(rarity)}
                    onClick={() => onChange(toggleRarity(filters, rarity))}
                  >
                    {RARITY_LABEL[rarity]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </Section>

          <Section title="Set">
            <div className="flex gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Match</span>
                <select
                  aria-label="Set match"
                  className="h-11 rounded-lg border border-input bg-transparent px-2"
                  value={filters.setExcluded ? "!=" : "="}
                  onChange={(event) => onChange({ ...filters, setExcluded: event.target.value === "!=" })}
                >
                  <option value="=">=</option>
                  <option value="!=">!=</option>
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Set code</span>
                <Input
                  value={filters.setCode}
                  onChange={(event) => onChange({ ...filters, setCode: event.target.value })}
                  placeholder="mh3"
                  className="h-11"
                />
              </label>
            </div>
          </Section>

          <Section title="Sort and printings">
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Sort</span>
                <select
                  aria-label="Sort order"
                  className="h-11 rounded-lg border border-input bg-transparent px-2"
                  value={filters.order}
                  onChange={(event) => onChange({ ...filters, order: event.target.value as "" | SortOrder })}
                >
                  <option value="">Default</option>
                  {SORT_ORDERS.map((order) => (
                    <option key={order} value={order}>
                      {order}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Direction</span>
                <select
                  aria-label="Sort direction"
                  className="h-11 rounded-lg border border-input bg-transparent px-2"
                  value={filters.direction}
                  onChange={(event) =>
                    onChange({ ...filters, direction: event.target.value as "" | SortDirection })
                  }
                >
                  <option value="">Auto</option>
                  {SORT_DIRECTIONS.map((direction) => (
                    <option key={direction} value={direction}>
                      {direction}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={filters.uniquePrints}
                onChange={(event) => onChange({ ...filters, uniquePrints: event.target.checked })}
              />
              Every printing
            </label>
          </Section>
        </div>
      )}
    </div>
  );
}
