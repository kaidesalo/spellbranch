"use client";

import { useTransition } from "react";
import Image from "next/image";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { groupCardsByType, totalCards } from "@/lib/card-types";
import {
  removeCardFromDeckAction,
  updateCardQuantityAction,
} from "@/lib/actions/decks";
import type { DeckCard } from "@/lib/types";

export function DeckList({
  deckId,
  cards,
  canEdit,
}: {
  deckId: string;
  cards: DeckCard[];
  canEdit: boolean;
}) {
  const groups = groupCardsByType(cards);
  const [pending, startTransition] = useTransition();

  function changeQty(card: DeckCard, next: number) {
    startTransition(async () => {
      const result = await updateCardQuantityAction(deckId, card.id, next);
      if (result.error) toast.error(result.error);
    });
  }

  function remove(card: DeckCard) {
    startTransition(async () => {
      const result = await removeCardFromDeckAction(deckId, card.id);
      if (result.error) toast.error(result.error);
      else toast.success(`Removed ${card.cardName}`);
    });
  }

  if (cards.length === 0) {
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
        {totalCards(cards)} cards · {cards.length} unique
      </p>
      {groups.map((group) => (
        <section key={group.type}>
          <h3 className="mb-2 flex items-center justify-between font-heading text-sm font-semibold uppercase tracking-wide text-primary">
            <span>{group.type}</span>
            <span className="text-muted-foreground">{group.count}</span>
          </h3>
          <ul className="divide-y divide-border/70 rounded-xl border border-border/70 bg-background/50">
            {group.cards.map((card) => (
              <li
                key={card.id}
                className="flex items-center gap-3 px-3 py-2"
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
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{card.cardName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {card.manaCost ?? "—"} · {card.typeLine}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="outline"
                      disabled={pending}
                      onClick={() => changeQty(card, card.quantity - 1)}
                      aria-label={`Decrease ${card.cardName}`}
                    >
                      <Minus />
                    </Button>
                    <span className="w-6 text-center text-sm font-semibold">
                      {card.quantity}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="outline"
                      disabled={pending}
                      onClick={() => changeQty(card, card.quantity + 1)}
                      aria-label={`Increase ${card.cardName}`}
                    >
                      <Plus />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => remove(card)}
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
