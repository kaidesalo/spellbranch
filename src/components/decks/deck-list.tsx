"use client";

import { useOptimistic, useTransition } from "react";
import Image from "next/image";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { groupCardsByType, totalCards } from "@/lib/card-types";
import { deckCountLabel } from "@/lib/commander";
import { MAX_CARD_QUANTITY } from "@/lib/deck-quantity";
import { QuantityInput } from "@/components/decks/quantity-input";
import { CardZoom } from "@/components/cards/card-zoom";
import { zoomCardFromSaved } from "@/lib/card-zoom";
import { updateCardQuantityAction } from "@/lib/actions/decks";
import type { DeckCard } from "@/lib/types";

export function DeckList({
  deckId,
  cards,
  canEdit,
  hasCommander = false,
}: {
  deckId: string;
  cards: DeckCard[];
  canEdit: boolean;
  /** Adds "1 commander +" to the count; the commander isn't in `cards`. */
  hasCommander?: boolean;
}) {
  // Quantity edits and removals show at once; if the server says no, the
  // transition ends with the server's `cards` unchanged and the optimistic
  // value rolls back on its own.
  const [shownCards, applyQuantity] = useOptimistic(
    cards,
    (state, { id, quantity }: { id: string; quantity: number }) =>
      quantity === 0
        ? state.filter((c) => c.id !== id)
        : state.map((c) => (c.id === id ? { ...c, quantity } : c)),
  );
  const groups = groupCardsByType(shownCards);
  const [pending, startTransition] = useTransition();

  /**
   * Every quantity change (the -/+ buttons, the typed value and the trash
   * button) goes through updateCardQuantityAction, which checks ownership
   * and the range on the server. 0 removes the card.
   */
  function setQuantity(card: DeckCard, next: number) {
    startTransition(async () => {
      applyQuantity({ id: card.id, quantity: next });
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

  if (shownCards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
        <p className="font-medium">No cards yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Search Scryfall on the left to add your first card.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {deckCountLabel(totalCards(shownCards), hasCommander)} · {shownCards.length} unique
      </p>
      {groups.map((group) => (
        <section key={group.type}>
          <h3 className="mb-2 flex items-center justify-between label-caps text-primary">
            <span>{group.type}</span>
            <span className="text-muted-foreground">{group.count}</span>
          </h3>
          <ul className="divide-y divide-border/70 rounded-xl border border-border/70 bg-background/50">
            {group.cards.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 px-3 py-2"
              >
                <CardZoom
                  card={zoomCardFromSaved(card.cardName, card.imageUri)}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  {card.imageUri ? (
                    <Image
                      src={card.imageUri}
                      alt=""
                      width={36}
                      height={50}
                      className="h-[50px] w-9 rounded object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="h-[50px] w-9 rounded bg-muted" />
                  )}
                  {/* spans, not p/div: a <button> may only hold phrasing content */}
                  <span className="block min-w-0 flex-1">
                    <span className="block truncate font-medium group-hover/zoom:underline">
                      {card.cardName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {card.manaCost ?? "—"} · {card.typeLine}
                    </span>
                  </span>
                </CardZoom>
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="outline"
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
                      size="icon-xs"
                      variant="outline"
                      disabled={pending || card.quantity >= MAX_CARD_QUANTITY}
                      onClick={() => setQuantity(card, card.quantity + 1)}
                      aria-label={`Increase ${card.cardName}`}
                    >
                      <Plus />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setQuantity(card, 0)}
                      aria-label={`Remove ${card.cardName}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm font-semibold">{card.quantity}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
