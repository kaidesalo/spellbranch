"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addCollectionCardAction,
  importCollectionListAction,
  removeCollectionCardAction,
  setCollectionVisibilityAction,
  updateCollectionCardAction,
} from "@/lib/actions/collection";
import {
  COLLECTION_CONDITIONS,
  COLLECTION_FINISHES,
  COLLECTION_MAX_QUANTITY,
  CONDITION_LABEL,
  FINISH_LABEL,
  collectionTotals,
  type CollectionCondition,
  type CollectionFinish,
} from "@/lib/collection";
import type { CollectionCard, Visibility } from "@/lib/types";
import { pickVisibleSelection, useScryfallSearch } from "@/components/cards/use-scryfall-search";
import { ChangePrintingSheet } from "@/components/cards/change-printing-sheet";
import type { ScryfallCard } from "@/lib/scryfall/client";

export function CollectionPanel({
  cards,
  visibility,
  initialQuery = "",
}: {
  cards: CollectionCard[];
  visibility: Visibility;
  initialQuery?: string;
}) {
  const totals = collectionTotals(cards);
  const [query, setQuery] = useState("");
  const [tradeOnly, setTradeOnly] = useState(false);
  const needle = query.trim().toLowerCase();
  const shown = cards.filter((card) => {
    if (tradeOnly && !card.forTrade) return false;
    if (!needle) return true;
    return card.cardName.toLowerCase().includes(needle);
  });

  return (
    <div className="min-w-0 space-y-6" data-testid="collection-panel">
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-card/70 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium tabular-nums text-muted-foreground">
            {totals.copies} {totals.copies === 1 ? "card" : "cards"} · {totals.unique} unique ·{" "}
            {totals.forTrade} for trade
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Other people only see piles you mark for trade, and only when you allow it below.
          </p>
        </div>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Who can see cards for trade</span>
          <VisibilitySelect visibility={visibility} />
        </label>
      </div>

      <AddCard initialQuery={initialQuery} />

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter your collection"
          aria-label="Filter your collection"
          className="min-w-0 sm:max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tradeOnly}
            onChange={(event) => setTradeOnly(event.target.checked)}
          />
          For trade
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {cards.length === 0 ? "No cards in your collection yet." : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-background/50">
          {shown.map((card) => (
            <CollectionRow key={`${card.id}-${card.updatedAt}`} card={card} />
          ))}
        </ul>
      )}

      <PasteList />
    </div>
  );
}

function VisibilitySelect({ visibility }: { visibility: Visibility }) {
  const [pending, startTransition] = useTransition();
  return (
    <select
      aria-label="Collection visibility"
      className="h-9 min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm"
      defaultValue={visibility}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(async () => {
          const result = await setCollectionVisibilityAction(next);
          if (result.error) toast.error(result.error);
          else toast.success("Updated who can see cards for trade");
        });
      }}
    >
      <option value="private">Private</option>
      <option value="friends">Friends</option>
      <option value="public">Public</option>
    </select>
  );
}

function AddCard({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState<CollectionFinish>("nonfoil");
  const [condition, setCondition] = useState<CollectionCondition | "">("");
  const [forTrade, setForTrade] = useState(false);
  const [pending, startTransition] = useTransition();
  const { cards, loading, error } = useScryfallSearch(query);
  const visible = pickVisibleSelection(cards, selected);

  function add() {
    if (!visible) return;
    startTransition(async () => {
      const result = await addCollectionCardAction({
        scryfallId: visible.id,
        quantity,
        finish,
        condition: condition || null,
        forTrade,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Added ${visible.name}`);
        setQuery("");
        setSelected(null);
      }
    });
  }

  return (
    <div className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4">
      <h2 className="text-lg font-semibold">Add a card</h2>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Scryfall…"
          aria-label="Search cards to add to your collection"
          className="pl-9"
        />
      </div>
      {loading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </p>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {cards.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                className={`w-full min-w-0 truncate rounded-lg px-3 py-2 text-left text-sm ${
                  visible?.id === card.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                }`}
                onClick={() => setSelected(card)}
              >
                {card.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="min-w-0 text-sm">
          <span className="text-muted-foreground">Qty</span>
          <Input
            type="number"
            min={1}
            max={COLLECTION_MAX_QUANTITY}
            value={quantity}
            aria-label="Quantity to add"
            onChange={(event) => setQuantity(Number(event.target.value) || 1)}
          />
        </label>
        <label className="min-w-0 text-sm">
          <span className="text-muted-foreground">Finish</span>
          <FinishSelect value={finish} onChange={setFinish} label="Finish to add" />
        </label>
        <label className="min-w-0 text-sm">
          <span className="text-muted-foreground">Condition</span>
          <ConditionSelect value={condition} onChange={setCondition} label="Condition to add" />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={forTrade} onChange={(event) => setForTrade(event.target.checked)} />
          For trade
        </label>
      </div>
      <Button className="mt-3" size="sm" disabled={pending || !visible} onClick={add}>
        <Plus data-icon="inline-start" />
        Add to collection
      </Button>
    </div>
  );
}

function CollectionRow({ card }: { card: CollectionCard }) {
  const [quantity, setQuantity] = useState(card.quantity);
  const [finish, setFinish] = useState<CollectionFinish>(card.finish);
  const [condition, setCondition] = useState<CollectionCondition | "">(card.condition ?? "");
  const [forTrade, setForTrade] = useState(card.forTrade);
  const [pending, startTransition] = useTransition();

  function save(next?: { forTrade?: boolean }) {
    const trade = next?.forTrade ?? forTrade;
    startTransition(async () => {
      const result = await updateCollectionCardAction(card.id, {
        quantity,
        finish,
        condition: condition || null,
        forTrade: trade,
      });
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <li className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
      {card.imageUri ? (
        <Image
          src={card.imageUri}
          alt=""
          width={36}
          height={50}
          className="h-[50px] w-9 shrink-0 rounded object-cover"
          unoptimized
        />
      ) : (
        <div className="h-[50px] w-9 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{card.cardName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {FINISH_LABEL[card.finish]}
          {card.condition ? ` · ${CONDITION_LABEL[card.condition]}` : ""}
          {card.forTrade ? " · For trade" : ""}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Input
          type="number"
          min={1}
          max={COLLECTION_MAX_QUANTITY}
          value={quantity}
          aria-label={`Quantity of ${card.cardName}`}
          className="w-full sm:w-20"
          onChange={(event) => setQuantity(Number(event.target.value) || 1)}
        />
        <FinishSelect value={finish} onChange={setFinish} label={`Finish of ${card.cardName}`} />
        <ConditionSelect
          value={condition}
          onChange={setCondition}
          label={`Condition of ${card.cardName}`}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={forTrade}
            aria-label={`${card.cardName} for trade`}
            onChange={(event) => {
              setForTrade(event.target.checked);
              save({ forTrade: event.target.checked });
            }}
          />
          Trade
        </label>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => save()}>
          Save
        </Button>
        <ChangePrintingSheet cardName={card.cardName} cardId={card.id} pending={pending} chooseFinish />
        <Button
          size="icon"
          variant="ghost"
          className="size-9"
          disabled={pending}
          aria-label={`Remove ${card.cardName}`}
          onClick={() => {
            startTransition(async () => {
              const result = await removeCollectionCardAction(card.id);
              if (result.error) toast.error(result.error);
            });
          }}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function PasteList() {
  const [list, setList] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <details className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Paste a list</summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Same plain text as a deck import, like 4 Lightning Bolt. Cards are added as nonfoil and not
        for trade. Sideboard and maybeboard lines are skipped.
      </p>
      <textarea
        value={list}
        onChange={(event) => setList(event.target.value)}
        aria-label="Collection list"
        className="mt-3 min-h-28 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm"
      />
      <Button
        className="mt-3"
        size="sm"
        disabled={pending || list.trim().length === 0}
        onClick={() => {
          startTransition(async () => {
            const result = await importCollectionListAction(list);
            if (result.error) toast.error(result.error);
            else {
              const missed = result.missing?.length ? ` Couldn't find ${result.missing.join(", ")}.` : "";
              toast.success(`Added ${result.added} ${result.added === 1 ? "card" : "cards"}.${missed}`);
              setList("");
            }
          });
        }}
      >
        Add list
      </Button>
    </details>
  );
}

function FinishSelect({
  value,
  onChange,
  label,
}: {
  value: CollectionFinish;
  onChange: (value: CollectionFinish) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className="h-9 min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value as CollectionFinish)}
    >
      {COLLECTION_FINISHES.map((finish) => (
        <option key={finish} value={finish}>
          {FINISH_LABEL[finish]}
        </option>
      ))}
    </select>
  );
}

function ConditionSelect({
  value,
  onChange,
  label,
}: {
  value: CollectionCondition | "";
  onChange: (value: CollectionCondition | "") => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className="h-9 min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value as CollectionCondition | "")}
    >
      <option value="">Unspecified</option>
      {COLLECTION_CONDITIONS.map((condition) => (
        <option key={condition} value={condition}>
          {CONDITION_LABEL[condition]}
        </option>
      ))}
    </select>
  );
}
