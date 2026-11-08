"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Loader2, Plus, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getCardImage,
  getCardManaCost,
  getCardOracleText,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import { addCardToDeckAction } from "@/lib/actions/decks";
import { addFavoriteAction } from "@/lib/actions/favorites";
import { zoomCardFromScryfall } from "@/lib/card-zoom";
import { offColorReason } from "@/lib/deck-colors";
import { CardZoom } from "./card-zoom";
import { ManaCost, ManaText } from "./mana-symbols";
import { pickVisibleSelection, useScryfallSearch } from "./use-scryfall-search";

export function CardSearch({
  deckId,
  canEdit,
  deckColors,
}: {
  deckId: string;
  canEdit: boolean;
  /** null: the deck has no colors, so every card fits. */
  deckColors: string[] | null;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [pending, startTransition] = useTransition();
  const { cards: visibleCards, loading, error, showEmptyHint } = useScryfallSearch(query);
  const visibleSelected = pickVisibleSelection(visibleCards, selected);
  // Display only: the server checks the color identity it fetches itself.
  const offColor = (card: ScryfallCard) => offColorReason(card.color_identity ?? [], deckColors);
  const selectedOffColor = visibleSelected ? offColor(visibleSelected) : null;

  function addSelected() {
    if (!visibleSelected || !canEdit || selectedOffColor) return;
    startTransition(async () => {
      // Only the id: the server fetches the card (and its color identity)
      // from Scryfall itself.
      const result = await addCardToDeckAction(deckId, {
        scryfallId: visibleSelected.id,
        quantity: 1,
      });
      if (result.error) toast.error(result.error);
      else toast.success(`Added ${visibleSelected.name}`);
    });
  }

  function favoriteSelected() {
    if (!visibleSelected) return;
    startTransition(async () => {
      const result = await addFavoriteAction({
        scryfallId: visibleSelected.id,
        cardName: visibleSelected.name,
        imageUri: getCardImage(visibleSelected),
        manaCost: getCardManaCost(visibleSelected),
        typeLine: visibleSelected.type_line,
      });
      if (result.error) toast.error(result.error);
      else toast.success(`Saved ${visibleSelected.name} to favorites`);
    });
  }

  const image = visibleSelected ? getCardImage(visibleSelected) : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Scryfall…"
          className="pl-9"
          aria-label="Search cards"
        />
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {showEmptyHint && (
        <p className="text-sm text-muted-foreground">No cards found.</p>
      )}

      <div className="grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-[1fr_160px]">
        <ul className="max-h-60 space-y-1 overflow-y-auto pr-1 lg:max-h-[420px]">
          {visibleCards.map((card) => {
            const reason = offColor(card);
            const active = visibleSelected?.id === card.id;
            return (
              <li key={card.id}>
                {/* Off-color cards stay selectable (preview, favorite) but
                    are greyed out with the reason, and can't be added. */}
                <button
                  type="button"
                  onClick={() => setSelected(card)}
                  aria-describedby={reason ? `off-color-${card.id}` : undefined}
                  data-off-color={reason ? "true" : undefined}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                  } ${reason && !active ? "opacity-55 grayscale" : ""}`}
                >
                  <div className="font-medium">{card.name}</div>
                  <div
                    className={`text-xs ${
                      active ? "text-primary-foreground/80" : "text-muted-foreground"
                    }`}
                  >
                    <ManaCost cost={getCardManaCost(card)} fallback="—" /> · {card.type_line}
                  </div>
                  {reason && (
                    <div
                      id={`off-color-${card.id}`}
                      className={`mt-0.5 text-xs font-semibold ${
                        active ? "text-primary-foreground/90" : "text-[#4b3d44]"
                      }`}
                    >
                      Off-color: {reason}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Empty slab stays a desktop sidebar affordance. Once a card is
            selected, phones put the rules text and actions beside the art
            (the space to the right of a card-sized image). lg+ keeps the
            sidebar stack. Below 370px the art shrinks so the buttons still
            have a column of their own instead of dropping back underneath. */}
        <div
          className={cn(
            "self-start rounded-xl border border-border/70 bg-background/60 p-2",
            visibleSelected ? "w-full" : "hidden lg:block",
          )}
        >
          <div className={cn(visibleSelected && "flex items-start gap-2.5 lg:block")}>
            <div
              className={cn(
                visibleSelected ? "w-[7rem] shrink-0 min-[370px]:w-40 lg:w-full" : "w-full",
              )}
            >
              {visibleSelected && image ? (
                <CardZoom card={zoomCardFromScryfall(visibleSelected)} className="block w-full">
                  <Image
                    src={image}
                    alt={visibleSelected.name}
                    width={146}
                    height={204}
                    className="mx-auto h-auto w-full rounded-lg"
                    unoptimized
                  />
                </CardZoom>
              ) : (
                <div className="flex aspect-[5/7] items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                  Card preview
                </div>
              )}
            </div>
            {visibleSelected && (
              <div className="min-w-0 flex-1 space-y-2 lg:mt-2">
                <p className="line-clamp-4 text-xs text-muted-foreground">
                  {getCardOracleText(visibleSelected) ? (
                    <ManaText text={getCardOracleText(visibleSelected)} />
                  ) : (
                    "No rules text."
                  )}
                </p>
                <div className="flex flex-col gap-2">
                  {canEdit && (
                    <Button
                      size="sm"
                      className="max-lg:h-8 max-lg:w-full max-lg:tracking-normal!"
                      onClick={addSelected}
                      disabled={pending || Boolean(selectedOffColor)}
                      aria-describedby={selectedOffColor ? "add-off-color" : undefined}
                    >
                      <Plus data-icon="inline-start" />
                      Add card
                    </Button>
                  )}
                  {canEdit && selectedOffColor && (
                    <p id="add-off-color" className="text-xs font-semibold text-[#4b3d44]">
                      Can&apos;t add: {selectedOffColor}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="max-lg:h-8 max-lg:w-full max-lg:tracking-normal!"
                    onClick={favoriteSelected}
                    disabled={pending}
                  >
                    <Star data-icon="inline-start" />
                    Favorite
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
