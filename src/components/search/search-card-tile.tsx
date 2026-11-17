"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Images, Layers } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PrintingPickerSheet, type PrintingChoice } from "@/components/cards/printing-picker-sheet";
import { addCollectionCardAction } from "@/lib/actions/collection";
import { addCardToDeckAction, listOwnedDecksAction } from "@/lib/actions/decks";
import { safeNextPath } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";

export type SearchCardHit = {
  id: string;
  name: string;
  typeLine: string;
  setName: string;
  image: string | null;
  oracleId: string | null;
};

function signInHref(returnHref: string): string {
  return `/login?next=${encodeURIComponent(safeNextPath(returnHref, "/search"))}`;
}

export function SearchCardTile({
  card,
  view,
  signedIn,
  returnHref,
}: {
  card: SearchCardHit;
  view: "grid" | "list";
  signedIn: boolean;
  returnHref: string;
}) {
  const [printing, setPrinting] = useState<PrintingChoice>({
    id: card.id,
    setName: card.setName,
    image: card.image,
  });
  const loginHref = signInHref(returnHref);

  return (
    <li
      data-testid="search-card-tile"
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card/70 p-2 sm:p-3",
        view === "list" && "flex items-center gap-3",
      )}
    >
      {printing.image ? (
        // Native img keeps loading="lazy" and the Scryfall CDN URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={printing.image}
          alt={card.name}
          width={view === "grid" ? 244 : 122}
          height={view === "grid" ? 340 : 170}
          loading="lazy"
          className={cn("h-auto max-w-full rounded-lg", view === "grid" ? "w-full" : "w-20 shrink-0")}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-lg bg-background text-sm text-muted-foreground",
            view === "grid" ? "h-40 w-full" : "h-28 w-20 shrink-0",
          )}
        >
          No image
        </div>
      )}
      <div className={cn("min-w-0 flex-1", view === "grid" && "mt-2")}>
        <p className="truncate font-medium">{card.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[printing.setName, card.typeLine].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2 flex min-w-0 items-center gap-1">
          {signedIn ? (
            <AddToCollection id={printing.id} name={card.name} />
          ) : (
            <Link
              href={loginHref}
              aria-label="Sign in to add"
              className="inline-flex h-11 min-w-0 flex-1 items-center justify-center truncate rounded-lg border border-border px-2 text-xs font-medium text-primary"
            >
              Sign in
            </Link>
          )}
          {signedIn ? (
            <AddToDeckButton scryfallId={printing.id} name={card.name} />
          ) : (
            <Link
              href={loginHref}
              aria-label={`Add ${card.name} to a deck`}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground"
            >
              <Layers className="size-4" aria-hidden />
            </Link>
          )}
          <ChangePrintingButton
            card={card}
            currentId={printing.id}
            signedIn={signedIn}
            loginHref={loginHref}
            onPick={setPrinting}
          />
        </div>
      </div>
    </li>
  );
}

function AddToCollection({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Add ${name} to collection`}
      disabled={pending || added}
      className="inline-flex h-11 min-w-0 max-w-full flex-1 items-center justify-center rounded-lg border border-border px-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      onClick={() => {
        startTransition(async () => {
          const result = await addCollectionCardAction({ scryfallId: id });
          if (result.error) toast.error(result.error);
          else setAdded(true);
        });
      }}
    >
      <span className="truncate">{added ? "Added" : "Add"}</span>
    </button>
  );
}

function AddToDeckButton({ scryfallId, name }: { scryfallId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [decks, setDecks] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function openPicker() {
    setOpen(true);
    setError(null);
    const result = await listOwnedDecksAction();
    if ("error" in result) {
      setDecks([]);
      setError(result.error);
      return;
    }
    setDecks(result.decks);
  }

  function add(deckId: string, deckName: string) {
    startTransition(async () => {
      const result = await addCardToDeckAction(deckId, { scryfallId, quantity: 1 });
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Added ${name} to ${deckName}`);
        setOpen(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Add ${name} to a deck`}
        aria-haspopup="dialog"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => void openPicker()}
      >
        <Layers className="size-4" aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl">
            <SheetHeader className="text-left">
              <SheetTitle>Add to deck</SheetTitle>
              <SheetDescription>Choose one of your decks for {name}.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
              {error && <p className="text-sm text-destructive">{error}</p>}
              {!error && decks.length === 0 && (
                <p className="text-sm text-muted-foreground">You don&apos;t have a deck yet.</p>
              )}
              {decks.map((deck) => (
                <button
                  key={deck.id}
                  type="button"
                  disabled={pending}
                  className="min-h-11 truncate rounded-lg border border-border px-3 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => add(deck.id, deck.name)}
                >
                  {deck.name}
                </button>
              ))}
            </div>
          </SheetContent>
      </Sheet>
    </>
  );
}

function ChangePrintingButton({
  card,
  currentId,
  signedIn,
  loginHref,
  onPick,
}: {
  card: SearchCardHit;
  currentId: string;
  signedIn: boolean;
  loginHref: string;
  onPick: (printing: PrintingChoice) => void;
}) {
  const label = `Change printing of ${card.name}`;
  const [open, setOpen] = useState(false);

  if (!signedIn) {
    return (
      <Link
        href={loginHref}
        aria-label={label}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground"
      >
        <Images className="size-4" aria-hidden />
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
      >
        <Images className="size-4" aria-hidden />
      </button>
      <PrintingPickerSheet
        open={open}
        onOpenChange={setOpen}
        oracleId={card.oracleId}
        currentId={currentId}
        cardName={card.name}
        onPick={onPick}
      />
    </>
  );
}
