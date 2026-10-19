import Link from "next/link";
import type { ReactNode } from "react";
import type { DeckWithMeta } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { visibilityLabel } from "@/lib/permissions";

export function DeckCardSummary({
  deck,
  badge,
}: {
  deck: DeckWithMeta;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={`/decks/${deck.id}`}
      className="group block rounded-2xl border border-border/80 bg-card/70 p-5 transition hover:border-primary/40 hover:bg-card"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-lg font-semibold group-hover:text-primary">
          {deck.name}
        </h3>
        {badge}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline" className="capitalize">
          {deck.format}
        </Badge>
        <Badge variant="secondary">{visibilityLabel(deck.visibility)}</Badge>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {deck.cardCount ?? 0} cards
        {deck.forkCount ? ` · ${deck.forkCount} forks` : ""}
        {deck.owner ? ` · @${deck.owner.username}` : ""}
      </p>
    </Link>
  );
}
