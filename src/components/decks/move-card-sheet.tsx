"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getPrimaryType } from "@/lib/card-types";
import type { DeckCard, DeckCategory } from "@/lib/types";

/**
 * Per-card "Move to category" sheet. The type group is the default: choosing
 * it clears the assignment. Custom categories are the ones the owner created.
 */
export function MoveCardSheet({
  card,
  categories,
  pending,
  onMove,
}: {
  card: DeckCard;
  categories: DeckCategory[];
  pending: boolean;
  onMove: (categoryId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const typeName = getPrimaryType(card.typeLine);
  const sorted = [...categories].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const current = card.categoryId && sorted.some((c) => c.id === card.categoryId) ? card.categoryId : null;

  function choose(categoryId: string | null) {
    setOpen(false);
    if (categoryId === current) return;
    onMove(categoryId);
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-10 px-2.5 tracking-normal! text-xs"
        disabled={pending}
        aria-haspopup="dialog"
        aria-label={`Move ${card.cardName} to a category`}
        onClick={() => setOpen(true)}
      >
        Move
      </Button>
      {open && (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          data-testid="move-card-sheet"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-border bg-card pb-6"
        >
          <SheetHeader className="pr-10 text-left">
            <SheetTitle className="font-display text-xl">Move {card.cardName}</SheetTitle>
            <SheetDescription>
              Choose a category. The type group is where a card goes when it has no category of its own.
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-2 px-4">
            <li>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/60 px-3 py-3 text-left hover:border-primary/60"
                onClick={() => choose(null)}
              >
                <span>
                  <span className="block font-medium">{typeName}</span>
                  <span className="block text-xs text-muted-foreground">Type group</span>
                </span>
                {current === null && <Check className="size-4 text-primary" aria-label="Current category" />}
              </button>
            </li>
            {sorted.map((category) => (
              <li key={category.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/60 px-3 py-3 text-left hover:border-primary/60"
                  onClick={() => choose(category.id)}
                >
                  <span className="min-w-0 break-words font-medium">{category.name}</span>
                  {current === category.id && (
                    <Check className="size-4 shrink-0 text-primary" aria-label="Current category" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
      )}
    </>
  );
}
