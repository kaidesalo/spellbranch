"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BOARD_LABEL, DECK_BOARDS, normalizeBoard, type DeckBoard } from "@/lib/deck-boards";
import type { DeckCard } from "@/lib/types";

/**
 * Per-card "move to another board" sheet. The current board is omitted.
 * Mainboard is the deck; sideboard and maybeboard are holding areas.
 */
export function MoveBoardSheet({
  card,
  pending,
  onMove,
}: {
  card: DeckCard;
  pending: boolean;
  onMove: (board: DeckBoard) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = normalizeBoard(card.board);
  const choices = DECK_BOARDS.filter((board) => board !== current);

  function choose(board: DeckBoard) {
    setOpen(false);
    onMove(board);
  }

  return (
    <>
      <Button
        size="icon"
        variant="outline"
        className="size-9"
        disabled={pending}
        aria-haspopup="dialog"
        aria-label={`Move ${card.cardName} to another board`}
        onClick={() => setOpen(true)}
      >
        <Layers />
        <span className="sr-only">Board</span>
      </Button>
      {open && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            data-testid="move-board-sheet"
            className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-border bg-card pb-6"
          >
            <SheetHeader className="pr-10 text-left">
              <SheetTitle className="font-display text-xl">Move {card.cardName}</SheetTitle>
              <SheetDescription>
                {BOARD_LABEL[current]} now. Only the mainboard counts toward the deck total and its colors.
              </SheetDescription>
            </SheetHeader>
            <ul className="flex flex-col gap-2 px-4">
              {choices.map((board) => (
                <li key={board}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/60 px-3 py-3 text-left hover:border-primary/60"
                    onClick={() => choose(board)}
                  >
                    <span>
                      <span className="block font-medium">{BOARD_LABEL[board]}</span>
                      <span className="block text-xs text-muted-foreground">
                        {board === "main"
                          ? "Part of the deck total and color checks"
                          : "Shown on this deck, not part of the total"}
                      </span>
                    </span>
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
