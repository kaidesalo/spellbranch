"use client";

import { useOptimistic, useTransition } from "react";
import Image from "next/image";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { groupDeckCards } from "@/lib/deck-categories";
import { totalCards } from "@/lib/card-types";
import { deckCountLabel } from "@/lib/commander";
import { MAX_CARD_QUANTITY } from "@/lib/deck-quantity";
import { QuantityInput } from "@/components/decks/quantity-input";
import { MoveCardSheet } from "@/components/decks/move-card-sheet";
import { CardZoom } from "@/components/cards/card-zoom";
import { ManaCost } from "@/components/cards/mana-symbols";
import { zoomCardFromSaved } from "@/lib/card-zoom";
import { moveCardToCategoryAction, updateCardQuantityAction } from "@/lib/actions/decks";
import type { DeckCard, DeckCategory, DeckTypeOrder } from "@/lib/types";

type ListChange =
  | { type: "quantity"; id: string; quantity: number }
  | { type: "category"; id: string; categoryId: string | null };

export function DeckList({
  deckId,
  cards,
  categories = [],
  typeSectionOrders = [],
  canEdit,
  hasCommander = false,
}: {
  deckId: string;
  cards: DeckCard[];
  categories?: DeckCategory[];
  typeSectionOrders?: DeckTypeOrder[];
  canEdit: boolean;
  /** Adds "1 commander +" to the count; the commander isn't in `cards`. */
  hasCommander?: boolean;
}) {
  // Quantity edits, removals, and category moves show at once; if the server
  // says no, the transition ends with the server's `cards` unchanged and the
  // optimistic value rolls back on its own.
  const [shownCards, applyChange] = useOptimistic(cards, (state, change: ListChange) => {
    if (change.type === "quantity") {
      return change.quantity === 0
        ? state.filter((c) => c.id !== change.id)
        : state.map((c) => (c.id === change.id ? { ...c, quantity: change.quantity } : c));
    }
    return state.map((c) => (c.id === change.id ? { ...c, categoryId: change.categoryId } : c));
  });
  const groups = groupDeckCards(shownCards, categories, typeSectionOrders);
  const [pending, startTransition] = useTransition();

  /**
   * Every quantity change (the -/+ buttons, the typed value and the trash
   * button) goes through updateCardQuantityAction, which checks ownership
   * and the range on the server. 0 removes the card.
   */
  function setQuantity(card: DeckCard, next: number) {
    startTransition(async () => {
      applyChange({ type: "quantity", id: card.id, quantity: next });
      let error: string | undefined;
      try {
        error = (await updateCardQuantityAction(deckId, card.id, next)).error;
      } catch {
        error = next === 0 ? "Could not remove card" : "Could not update card";
      }
      if (error) toast.error(error);
      else if (next === 0) toast.success(`Removed ${card.cardName}`);
    });
  }

  function moveCard(card: DeckCard, categoryId: string | null) {
    startTransition(async () => {
      applyChange({ type: "category", id: card.id, categoryId });
      let error: string | undefined;
      try {
        error = (await moveCardToCategoryAction(deckId, card.id, categoryId)).error;
      } catch {
        error = "Could not move card";
      }
      if (error) toast.error(error);
    });
  }

  if (shownCards.length === 0 && categories.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
        <p className="font-medium">No cards yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="lg:hidden">Search Scryfall above to add your first card.</span>
          <span className="hidden lg:inline">Search Scryfall on the left to add your first card.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm font-medium tabular-nums text-muted-foreground">
        {deckCountLabel(totalCards(shownCards), hasCommander)} · {shownCards.length} unique
      </p>
      {groups.map((group) => (
        <section key={group.key} data-kind={group.kind}>
          <h3 className="mb-2 flex items-center justify-between gap-3 label-caps text-primary">
            <span className="min-w-0 break-words">{group.label}</span>
            <span className="font-medium tabular-nums tracking-normal text-muted-foreground">
              {group.count}
            </span>
          </h3>
          <ul className="divide-y divide-border/70 rounded-xl border border-border/70 bg-background/50">
            {group.cards.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground">No cards in this category yet.</li>
            )}
            {group.cards.map((card) => (
              <li
                key={card.id}
                className="flex min-w-0 items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3 sm:py-2"
              >
                <CardZoom
                  card={zoomCardFromSaved(card.cardName, card.imageUri)}
                  className="flex min-w-0 flex-1 basis-0 items-center gap-2 overflow-hidden sm:gap-3"
                >
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
                  {/* spans, not p/div: a <button> may only hold phrasing content */}
                  <span className="block min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate font-medium group-hover/zoom:underline">
                        {card.cardName}
                      </span>
                      {!canEdit && (
                        <span className="shrink-0 rounded bg-muted px-1 py-px text-[0.7rem] font-medium leading-none tabular-nums text-muted-foreground">
                          x{card.quantity}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <ManaCost cost={card.manaCost} fallback="—" /> · {card.typeLine}
                    </span>
                  </span>
                </CardZoom>
                {canEdit && (
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-0.5">
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-9"
                        disabled={pending}
                        onClick={() => setQuantity(card, card.quantity - 1)}
                        aria-label={`Decrease ${card.cardName}`}
                      >
                        <Minus />
                      </Button>
                      <QuantityInput
                        cardName={card.cardName}
                        quantity={card.quantity}
                        busy={pending}
                        onCommit={(next) => setQuantity(card, next)}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-9"
                        disabled={pending || card.quantity >= MAX_CARD_QUANTITY}
                        onClick={() => setQuantity(card, card.quantity + 1)}
                        aria-label={`Increase ${card.cardName}`}
                      >
                        <Plus />
                      </Button>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-9"
                        disabled={pending}
                        onClick={() => setQuantity(card, 0)}
                        aria-label={`Remove ${card.cardName}`}
                      >
                        <Trash2 />
                      </Button>
                      <MoveCardSheet
                        card={card}
                        categories={categories}
                        pending={pending}
                        onMove={(categoryId) => moveCard(card, categoryId)}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
