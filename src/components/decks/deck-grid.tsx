import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeckCardSummary } from "@/components/decks/deck-card-summary";
import type { DeckWithMeta } from "@/lib/types";

export function DeckGrid({
  decks,
  badge,
  showSource = false,
}: {
  decks: DeckWithMeta[];
  badge?: React.ReactNode;
  showSource?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((deck) => (
        <DeckCardSummary key={deck.id} deck={deck} badge={badge} showSource={showSource} />
      ))}
    </div>
  );
}

export function DeckEmpty({
  title,
  body,
  href,
  cta,
  secondaryHref,
  secondaryCta,
}: {
  title: string;
  body: string;
  href?: string;
  cta?: string;
  secondaryHref?: string;
  secondaryCta?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {(href && cta) || (secondaryHref && secondaryCta) ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {href && cta ? <Button render={<Link href={href} />}>{cta}</Button> : null}
          {secondaryHref && secondaryCta ? (
            <Button variant="outline" render={<Link href={secondaryHref} />}>
              {secondaryCta}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BranchBadge() {
  return <Badge variant="secondary">Branch</Badge>;
}

export function FriendBranchBadge() {
  return <Badge variant="secondary">Friend branch</Badge>;
}
