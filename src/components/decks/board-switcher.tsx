import Link from "next/link";
import { BOARD_LABEL, DECK_BOARDS, type DeckBoard } from "@/lib/deck-boards";
import { cn } from "@/lib/utils";

/**
 * Main / side / maybe, as links so the deck list and the card search share
 * one board. Counts are that board's quantity. The deck's published size
 * stays the mainboard count in the page header.
 */
export function BoardSwitcher({
  deckId,
  current,
  counts,
}: {
  deckId: string;
  current: DeckBoard;
  counts: Record<DeckBoard, number>;
}) {
  return (
    <nav
      aria-label="Deck boards"
      data-testid="board-switcher"
      className="grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-border/80 bg-card/70 p-1"
    >
      {DECK_BOARDS.map((board) => {
        const count = counts[board];
        const label = BOARD_LABEL[board];
        const active = board === current;
        const href = board === "main" ? `/decks/${deckId}` : `/decks/${deckId}?board=${board}`;
        return (
          <Link
            key={board}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`board-tab-${board}`}
            title={label}
            className={cn(
              "flex min-w-0 flex-col items-center rounded-lg px-1.5 py-2 text-center",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-secondary",
            )}
          >
            <span className="w-full truncate text-sm font-semibold">{label}</span>
            <span
              className={cn(
                "text-xs font-medium tabular-nums",
                active ? "text-primary-foreground/80" : "text-muted-foreground",
              )}
            >
              {count} {count === 1 ? "card" : "cards"}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
