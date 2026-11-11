"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Crown, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setCommanderAction } from "@/lib/actions/decks";
import { scryfallFrontTypeLine } from "@/lib/commander";
import {
  getCardImage,
  getCardManaCost,
  getCardOracleText,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import type { DeckCommander } from "@/lib/types";
import {
  pickVisibleSelection,
  useScryfallSearch,
} from "@/components/cards/use-scryfall-search";
import { CardZoom } from "@/components/cards/card-zoom";
import { ManaCost, ManaText } from "@/components/cards/mana-symbols";
import { zoomCardFromSaved, zoomCardFromScryfall } from "@/lib/card-zoom";
import { offColorReason } from "@/lib/deck-colors";

// Magic color-identity pips. Fills stay distinct WUBRG hues; the letter and
// ring colors are from the brand palette so they stay readable on navy.
const PIP: Record<string, { label: string; className: string }> = {
  W: { label: "White", className: "bg-[#F4EBDD] text-[#10141F] ring-[#344158]" },
  U: { label: "Blue", className: "bg-[#4b726e] text-white ring-[#344158]" },
  B: { label: "Black", className: "bg-[#10141F] text-[#F4EBDD] ring-[#ABB7C9]" },
  R: { label: "Red", className: "bg-[#ae5d40] text-white ring-[#344158]" },
  G: { label: "Green", className: "bg-[#5d5b2e] text-[#F4EBDD] ring-[#344158]" },
};

function ColorIdentity({ colors }: { colors: string[] }) {
  if (colors.length === 0) {
    return <span className="text-xs text-muted-foreground">Colorless</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap gap-1" aria-label={`Color identity: ${colors.map((c) => PIP[c]?.label ?? c).join(", ")}`}>
      {colors.map((c) => (
        <span
          key={c}
          aria-hidden
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ring-1 ${PIP[c]?.className ?? ""}`}
        >
          {c}
        </span>
      ))}
    </span>
  );
}

/**
 * The commander slot on a Commander deck's page. Everyone who can see the
 * deck sees the commander; only the owner gets Choose / Change / Clear.
 */
export function CommanderSlot({
  deckId,
  commander,
  canEdit,
  alsoInDeckList,
  deckColors,
}: {
  deckId: string;
  commander: DeckCommander | null;
  canEdit: boolean;
  alsoInDeckList: boolean;
  /** null: no deck colors yet; choosing a commander sets them. */
  deckColors: string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function clear() {
    startTransition(async () => {
      const result = await setCommanderAction(deckId, null);
      if (result.error) toast.error(result.error);
      else toast.success("Commander cleared");
    });
  }

  return (
    <section
      aria-labelledby="commander-heading"
      className="overflow-hidden rounded-2xl border-2 border-primary/70 bg-card shadow-[4px_4px_0_0_#344158]"
    >
      {commander ? (
        <div className="grid min-w-0 sm:grid-cols-[minmax(0,1fr)_170px]">
          <div className="min-w-0">
            <div className="relative aspect-[626/300] max-h-56 w-full overflow-hidden bg-background sm:max-h-none">
              {commander.artUri ? (
                <Image
                  src={commander.artUri}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="object-cover"
                  unoptimized
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-foreground">
                <p id="commander-heading" className="label-caps flex items-center gap-1.5 text-primary">
                  <Crown className="h-3.5 w-3.5" aria-hidden /> Commander
                </p>
                <p className="mt-1 text-2xl font-medium leading-tight sm:text-3xl">
                  <CardZoom
                    card={zoomCardFromSaved(commander.cardName, commander.imageUri)}
                    className="hover:underline focus-visible:ring-ring/70"
                  >
                    {commander.cardName}
                  </CardZoom>
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
              <span className="min-w-0 basis-full break-words sm:basis-auto">{commander.typeLine}</span>
              <ManaCost cost={commander.manaCost} className="text-base" />
              <ColorIdentity colors={commander.colorIdentity} />
            </div>
            {alsoInDeckList && (
              <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
                {commander.cardName} is also in the deck list. The commander slot is
                separate, so you can remove that copy.
              </p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2 border-t border-border/70 px-4 py-3">
                <Button size="sm" onClick={() => setOpen(true)} disabled={pending}>
                  Change commander
                </Button>
                <Button size="sm" variant="outline" onClick={clear} disabled={pending}>
                  <X data-icon="inline-start" />
                  Clear
                </Button>
              </div>
            )}
          </div>
          {commander.imageUri && (
            <div className="hidden border-l border-border/70 bg-background/50 p-3 sm:block">
              <CardZoom
                card={zoomCardFromSaved(commander.cardName, commander.imageUri)}
                className="block w-full"
              >
                <Image
                  src={commander.imageUri}
                  alt={commander.cardName}
                  width={146}
                  height={204}
                  className="h-auto w-full rounded-lg"
                  unoptimized
                />
              </CardZoom>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p id="commander-heading" className="label-caps flex items-center gap-1.5 text-primary">
              <Crown className="h-3.5 w-3.5" aria-hidden /> Commander
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canEdit
                ? "No commander yet. Choose a legendary creature to lead this deck."
                : "No commander chosen yet."}
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Crown data-icon="inline-start" />
              Choose commander
            </Button>
          )}
        </div>
      )}
      {canEdit && (
        <CommanderPicker
          deckId={deckId}
          open={open}
          onOpenChange={setOpen}
          currentId={commander?.scryfallId ?? null}
          deckColors={deckColors}
        />
      )}
    </section>
  );
}

function CommanderPicker({
  deckId,
  open,
  onOpenChange,
  currentId,
  deckColors,
}: {
  deckId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId: string | null;
  deckColors: string[] | null;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [pending, startTransition] = useTransition();
  const { cards, loading, error, showEmptyHint } = useScryfallSearch(query, "commander");
  const visibleSelected = pickVisibleSelection(cards, selected);
  const image = visibleSelected ? getCardImage(visibleSelected) : null;
  // Display only: the server checks the identity it fetches from Scryfall.
  const offColor = (card: ScryfallCard) => offColorReason(card.color_identity ?? [], deckColors);
  const selectedOffColor = visibleSelected ? offColor(visibleSelected) : null;

  function choose() {
    if (!visibleSelected || selectedOffColor) return;
    const card = visibleSelected;
    startTransition(async () => {
      // Only the id goes to the server; it fetches the card from Scryfall
      // and checks it is a legendary creature itself.
      const result = await setCommanderAction(deckId, card.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${card.name} is now your commander`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose commander</DialogTitle>
          <DialogDescription>
            Legendary creatures only. Partners, backgrounds and planeswalker
            commanders aren&apos;t supported yet.{" "}
            {deckColors === null
              ? "This deck has no colors yet: it takes your commander's color identity."
              : "Your commander's color identity must fit the deck's colors."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search legendary creatures…"
            className="pl-9"
            aria-label="Search legendary creatures"
            autoFocus
          />
        </div>
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {showEmptyHint && (
          <p className="text-sm text-muted-foreground">No legendary creatures found.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <ul className="max-h-[360px] space-y-1 overflow-y-auto pr-1" aria-label="Legendary creatures">
            {cards.map((card) => {
              const active = visibleSelected?.id === card.id;
              const reason = offColor(card);
              return (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(card)}
                    aria-pressed={active}
                    aria-describedby={reason ? `cmd-off-color-${card.id}` : undefined}
                    data-off-color={reason ? "true" : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                    } ${reason && !active ? "opacity-55 grayscale" : ""}`}
                  >
                    <div className="font-medium">
                      {card.name}
                      {card.id === currentId && (
                        <span className="ml-2 text-xs font-normal opacity-80">(current)</span>
                      )}
                    </div>
                    <div className={`text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      <ManaCost cost={getCardManaCost(card)} fallback="—" /> · {scryfallFrontTypeLine(card)}
                    </div>
                    {reason && (
                      <div id={`cmd-off-color-${card.id}`} className="mt-0.5 text-xs font-semibold">
                        Off-color: {reason}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div
            className={`self-start rounded-xl border border-border/70 bg-background/60 p-2 ${
              visibleSelected ? "max-w-[11rem] sm:max-w-none" : "hidden sm:block"
            }`}
          >
            {visibleSelected && image ? (
              <CardZoom card={zoomCardFromScryfall(visibleSelected)} className="block w-full">
                <Image
                  src={image}
                  alt={visibleSelected.name}
                  width={166}
                  height={232}
                  className="mx-auto h-auto w-full rounded-lg"
                  unoptimized
                />
              </CardZoom>
            ) : (
              <div className="flex aspect-[5/7] items-center justify-center rounded-lg bg-muted px-2 text-center text-xs text-muted-foreground">
                Search by name, e.g. “Atraxa”
              </div>
            )}
            {visibleSelected && (
              <div className="mt-2 space-y-2">
                <p className="line-clamp-4 text-xs text-muted-foreground">
                  {getCardOracleText(visibleSelected) ? (
                    <ManaText text={getCardOracleText(visibleSelected)} />
                  ) : (
                    "No rules text."
                  )}
                </p>
                <Button
                  size="sm"
                  className="h-auto w-full whitespace-normal py-1.5"
                  onClick={choose}
                  disabled={pending || visibleSelected.id === currentId || Boolean(selectedOffColor)}
                  aria-describedby={selectedOffColor ? "set-off-color" : undefined}
                >
                  <Crown data-icon="inline-start" />
                  Set as commander
                </Button>
                {selectedOffColor && (
                  <p id="set-off-color" className="text-xs font-semibold text-destructive">
                    Can&apos;t set: {selectedOffColor}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
