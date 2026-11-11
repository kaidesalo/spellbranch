"use client";

import { useState, useTransition } from "react";
import { Images } from "lucide-react";
import { toast } from "sonner";
import { PrintingGrid, PrintingSkeleton } from "@/components/cards/printing-picker";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  changeCollectionPrintingAction,
  changeDeckPrintingAction,
  listCollectionPrintingsAction,
  listDeckPrintingsAction,
  type PrintingsResult,
} from "@/lib/actions/printings";
import type { CollectionFinish } from "@/lib/collection";
import { printingsWithCurrentFirst } from "@/lib/printing";
import type { CardPrinting } from "@/lib/scryfall/client";

/**
 * Lists every Scryfall printing of this card and swaps the row onto the one
 * the owner picks. The grid scrolls inside the sheet.
 */
export function ChangePrintingSheet({
  cardName,
  pending,
  deckId,
  cardId,
  chooseFinish = false,
}: {
  cardName: string;
  pending: boolean;
  cardId: string;
  deckId?: string;
  /** Collection piles pick a finish the printing actually offers. */
  chooseFinish?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [printings, setPrintings] = useState<CardPrinting[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function openPicker() {
    setOpen(true);
    setError(null);
    setPicked(null);
    setLoading(true);
    let result: PrintingsResult;
    try {
      result = deckId
        ? await listDeckPrintingsAction(deckId, cardId)
        : await listCollectionPrintingsAction(cardId);
    } catch {
      result = { error: "Could not load printings" };
    }
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setPrintings([]);
      return;
    }
    setCurrentId(result.currentId ?? null);
    setPrintings(result.printings ?? []);
  }

  function choose(printing: CardPrinting, finish: CollectionFinish | null) {
    startTransition(async () => {
      const result = deckId
        ? await changeDeckPrintingAction(deckId, cardId, printing.id)
        : await changeCollectionPrintingAction(cardId, printing.id, finish ?? printing.finishes[0] ?? "nonfoil");
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Changed ${cardName} to ${printing.setName}`);
        setOpen(false);
      }
    });
  }

  function onTile(printing: CardPrinting) {
    if (printing.id === currentId || busy) return;
    if (chooseFinish && printing.finishes.length > 1) {
      setPicked((id) => (id === printing.id ? null : printing.id));
      return;
    }
    if (chooseFinish && printing.finishes.length === 0) return;
    choose(printing, printing.finishes[0] ?? null);
  }

  const ordered = printingsWithCurrentFirst(printings, currentId);

  return (
    <>
      <Button
        size="icon"
        variant="outline"
        className="size-9"
        disabled={pending || busy}
        aria-haspopup="dialog"
        aria-label={`Change printing of ${cardName}`}
        onClick={() => void openPicker()}
      >
        <Images />
        <span className="sr-only">Printing</span>
      </Button>
      {open && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            data-testid="change-printing-sheet"
            className="flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-border bg-card pb-4 sm:max-h-[90vh]"
          >
            <SheetHeader className="mx-auto w-full max-w-[58rem] shrink-0 pr-10 text-left">
              <SheetTitle className="font-display text-xl">Change printing</SheetTitle>
              <SheetDescription>
                {cardName}. Quantity
                {chooseFinish ? ", for-trade status," : ", board, and category"} stay with this card.
              </SheetDescription>
            </SheetHeader>
            <div className="mx-auto min-h-0 w-full max-w-[58rem] flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2">
              {loading && <PrintingSkeleton />}
              {error && <p className="py-6 text-sm text-destructive">{error}</p>}
              {!loading && !error && ordered.length === 0 && (
                <p className="py-6 text-sm text-muted-foreground">No printings found.</p>
              )}
              {!loading && !error && ordered.length > 0 && (
                <PrintingGrid
                  printings={ordered}
                  currentId={currentId}
                  busy={busy}
                  chooseFinish={chooseFinish}
                  pickedId={picked}
                  onTile={onTile}
                  onFinish={(printing, finish) => choose(printing, finish)}
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
