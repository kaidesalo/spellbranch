import Link from "next/link";
import type { ReactNode } from "react";
import type { DeckWithMeta } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { visibilityLabel } from "@/lib/permissions";
import { deckCountLabel } from "@/lib/commander";

export function DeckCardSummary({
  deck,
  badge,
  showSource = false,
}: {
  deck: DeckWithMeta;
  badge?: ReactNode;
  /** "Branched from {source name}" — used for friend forks of your decks. */
  showSource?: boolean;
}) {
  return (
    <Link
      href={`/decks/${deck.id}`}
      className="group block rounded-2xl border border-border/80 bg-card/70 p-5 transition hover:border-primary/40 hover:bg-card"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display break-words text-lg font-semibold group-hover:text-primary">
          {deck.name}
        </h3>
        {badge}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">
          {deck.format}
        </Badge>
        <Badge variant="secondary">{visibilityLabel(deck.visibility)}</Badge>
      </div>
      <p className="mt-3 text-sm font-medium tabular-nums text-muted-foreground">
        {deckCountLabel(
          deck.cardCount ?? 0,
          deck.format === "commander" && Boolean(deck.commander),
        )}
        {deck.format === "commander" && deck.commander ? ` · ${deck.commander.cardName}` : ""}
        {deck.forkCount ? ` · ${deck.forkCount} forks` : ""}
        {deck.owner ? ` · @${deck.owner.username}` : ""}
      </p>
      {showSource && deck.sourceDeck && (
        <p className="mt-2 text-sm text-muted-foreground">
          Branched from {deck.sourceDeck.name}
        </p>
      )}
    </Link>
  );
}
