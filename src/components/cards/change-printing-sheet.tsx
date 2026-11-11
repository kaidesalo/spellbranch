"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Images } from "lucide-react";
import { toast } from "sonner";
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
import { FINISH_LABEL, type CollectionFinish } from "@/lib/collection";
import type { CardPrinting } from "@/lib/scryfall/client";

/**
 * Lists every Scryfall printing of this card and swaps the row onto the one
 * the owner picks. The list scrolls inside the sheet.
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
  const [picked, setPicked] = useState<CardPrinting | null>(null);
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
            className="flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border-border bg-card pb-4"
          >
            <SheetHeader className="shrink-0 pr-10 text-left">
              <SheetTitle className="font-display text-xl">Change printing</SheetTitle>
              <SheetDescription>
                {cardName}. Quantity
                {chooseFinish ? ", for-trade status," : ", board, and category"} stay with this card.
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
              {loading && <p className="py-6 text-sm text-muted-foreground">Loading printings…</p>}
              {error && <p className="py-6 text-sm text-destructive">{error}</p>}
              {!loading && !error && (
                <ul className="flex flex-col gap-2">
                  {printings.map((printing) => {
                    const current = printing.id === currentId;
                    return (
                      <li key={printing.id}>
                        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/80 bg-background/60 px-2 py-2">
                          {printing.imageUri ? (
                            <Image
                              src={printing.imageUri}
                              alt=""
                              width={32}
                              height={44}
                              className="h-11 w-8 shrink-0 rounded object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="h-11 w-8 shrink-0 rounded bg-muted" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {printing.setName}
                              {printing.setCode ? ` (${printing.setCode})` : ""}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              #{printing.collectorNumber || "—"}
                              {printing.releasedAt ? ` · ${printing.releasedAt}` : ""}
                              {printing.finishes.length > 0
                                ? ` · ${printing.finishes.map((finish) => FINISH_LABEL[finish]).join(", ")}`
                                : ""}
                            </p>
                          </div>
                          {current ? (
                            <span className="shrink-0 text-xs font-medium text-muted-foreground">Current</span>
                          ) : chooseFinish && printing.finishes.length > 1 ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              data-testid="printing-option"
                              onClick={() => setPicked(printing)}
                            >
                              Choose
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || (chooseFinish && printing.finishes.length === 0)}
                              data-testid="printing-option"
                              onClick={() => choose(printing, printing.finishes[0] ?? null)}
                            >
                              Use
                            </Button>
                          )}
                        </div>
                        {picked?.id === printing.id && (
                          <div className="mt-1 flex min-w-0 flex-wrap gap-2 px-2">
                            {printing.finishes.map((finish) => (
                              <Button
                                key={finish}
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => choose(printing, finish)}
                              >
                                {FINISH_LABEL[finish]}
                              </Button>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
