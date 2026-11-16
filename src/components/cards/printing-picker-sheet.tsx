"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { isUuid, scryfallImageOrNull } from "@/lib/data/validation";
import { getCardImage, type ScryfallCard } from "@/lib/scryfall/client";

export type PrintingChoice = {
  id: string;
  setName: string;
  image: string | null;
};

/**
 * The printing list from search (PR #55): `oracleid:` + `unique=prints`
 * through `/api/scryfall/search`. Search tiles and the commander slot both
 * use this sheet. It does not write anything; the caller decides what a
 * pick means.
 */
export function PrintingPickerSheet({
  open,
  onOpenChange,
  oracleId,
  currentId,
  cardName,
  onPick,
  busy = false,
  closeOnPick = true,
  testId = "search-printing-sheet",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oracleId: string | null;
  currentId: string;
  cardName: string;
  onPick: (printing: PrintingChoice) => void;
  busy?: boolean;
  closeOnPick?: boolean;
  testId?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printings, setPrintings] = useState<PrintingChoice[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setError(null);
      if (!oracleId) {
        setPrintings([]);
        setLoading(false);
        setError("This card has no other printings we can look up.");
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: `oracleid:${oracleId}`,
          unique: "prints",
          order: "released",
        });
        const res = await fetch(`/api/scryfall/search?${params}`);
        const data = (await res.json()) as { cards?: ScryfallCard[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load printings");
        const choices = (data.cards ?? [])
          .filter((hit) => hit.id && hit.oracle_id === oracleId && isUuid(hit.id))
          .map((hit) => ({
            id: hit.id,
            setName: hit.set_name?.trim() || "Unknown set",
            image: scryfallImageOrNull(getCardImage(hit)),
          }));
        if (cancelled) return;
        setPrintings(choices);
        if (choices.length === 0) setError("No printings found.");
      } catch (err) {
        if (cancelled) return;
        setPrintings([]);
        setError(err instanceof Error ? err.message : "Could not load printings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, oracleId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid={testId}
        className="max-h-[70vh] max-w-full overflow-hidden rounded-t-2xl"
      >
        <SheetHeader className="pr-14 text-left">
          <SheetTitle>Change printing</SheetTitle>
          <SheetDescription className="truncate">{cardName}</SheetDescription>
        </SheetHeader>
        <SheetClose
          render={
            <Button
              variant="ghost"
              aria-label="Close"
              className="absolute top-3 right-3 size-11"
            />
          }
        >
          <X className="size-4" />
        </SheetClose>
        <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto px-4 pb-4">
          {loading && <p className="text-sm text-muted-foreground">Loading printings…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {printings.map((printing) => {
            const current = printing.id === currentId;
            return (
              <button
                key={printing.id}
                type="button"
                disabled={busy}
                aria-current={current ? "true" : undefined}
                className="min-h-11 w-full min-w-0 truncate rounded-lg border border-border px-3 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                onClick={() => {
                  onPick(printing);
                  if (closeOnPick) onOpenChange(false);
                }}
              >
                {printing.setName}
                {current ? " · current" : ""}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
