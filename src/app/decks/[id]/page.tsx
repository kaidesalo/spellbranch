import Link from "next/link";
import { notFound } from "next/navigation";
import { GitCompareArrows, Settings2 } from "lucide-react";
import { ExportDeckButton } from "@/components/decks/export-deck-button";
import { getSessionUser } from "@/lib/auth/session";
import { getDeckById, getDeckPermissions } from "@/lib/queries/decks";
import { listComments } from "@/lib/queries/comments";
import { ORIGINAL_DECK_FORKS_LOCKED, visibilityLabel } from "@/lib/permissions";
import { branchSwitcherModel } from "@/lib/branch-switcher";
import { defaultBranchName, defaultCopyName } from "@/lib/fork-name";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardSearch } from "@/components/cards/card-search";
import { DeckList } from "@/components/decks/deck-list";
import { CategoryManager } from "@/components/decks/category-manager";
import { CommanderSlot } from "@/components/decks/commander-slot";
import { deckCountLabel } from "@/lib/commander";
import { boardCounts, cardsOnBoard, normalizeBoard } from "@/lib/deck-boards";
import { BoardSwitcher } from "@/components/decks/board-switcher";
import { CommentSection } from "@/components/comments/comment-section";
import { BranchSwitcher } from "@/components/decks/branch-switcher";
import { DeckColorsBadge } from "@/components/decks/deck-colors";
import { DeleteDeckButton } from "@/components/decks/delete-deck-button";
import { ForkDeckForm } from "@/components/decks/fork-deck-form";
import { CopyDeckForm } from "@/components/decks/copy-deck-form";

export default async function DeckDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ board?: string | string[] }>;
}) {
  const { id } = await params;
  const { board: boardParam } = await searchParams;
  const board = normalizeBoard(Array.isArray(boardParam) ? boardParam[0] : boardParam);
  const deck = await getDeckById(id);
  if (!deck) notFound();

  const user = await getSessionUser();
  const [{ canEdit, canFork, canCopy, canComment }, comments] = await Promise.all([
    getDeckPermissions(id),
    listComments(id),
  ]);
  // The branch itself would allow a fork, but the original deck has forks
  // turned off. The source row is only present when this viewer can see it.
  const rootForkLocked = Boolean(
    user &&
      deck.sourceDeck &&
      !deck.sourceDeck.allowForks &&
      deck.sourceDeck.ownerId !== user.id &&
      (deck.ownerId === user.id || deck.allowForks),
  );

  // Only branches the viewer can see are in deck.branches. If the preferred
  // branch isn't one of them, fall back to the first visible branch (or no
  // Compare link at all) instead of linking to a 404 (review L1).
  const preferred = deck.preferredBranchId
    ? deck.branches?.find((b) => b.id === deck.preferredBranchId)
    : undefined;
  const defaultCompareId = preferred?.id ?? deck.branches?.[0]?.id;
  const switcher = branchSwitcherModel(deck);

  // The commander is its own slot, not a deck-list entry (it isn't one of
  // the 99). Only Commander decks show the slot.
  const isCommanderFormat = deck.format === "commander";
  const commander = isCommanderFormat ? deck.commander : null;
  const allCards = deck.cards ?? [];
  const counts = boardCounts(allCards);
  const boardCards = cardsOnBoard(allCards, board);
  const mainCards = cardsOnBoard(allCards, "main");
  const commanderAlsoInList = Boolean(
    commander &&
      mainCards.some(
        (c) => c.scryfallId === commander.scryfallId || c.cardName === commander.cardName,
      ),
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
      <div
        data-testid="deck-header"
        className="flex w-full min-w-0 flex-col gap-3 border-b border-border/70 pb-4 lg:flex-row lg:items-start lg:justify-between lg:pb-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display break-words text-3xl font-semibold tracking-tight">
              {deck.name}
            </h1>
            {deck.forkedFromId && <Badge variant="secondary">Branch</Badge>}
            {deck.copiedFromDeck && (
              <Badge variant="secondary">Copy</Badge>
            )}
            {preferred && <Badge>Preferred: {preferred.name}</Badge>}
          </div>
          <p className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {deck.format}
            </Badge>
            {deck.colors && <DeckColorsBadge colors={deck.colors} />}
            <Badge variant="secondary">{visibilityLabel(deck.visibility)}</Badge>
            <span className="min-w-0 break-words font-medium tabular-nums">
              {deckCountLabel(deck.cardCount ?? 0, Boolean(commander))}
              {deck.owner ? ` · @${deck.owner.username}` : ""}
              {deck.allowForks ? " · forks allowed" : " · forks locked"}
            </span>
          </p>
          {deck.sourceDeck && (
            <p className="mt-2 text-sm">
              Forked from{" "}
              <Link
                href={`/decks/${deck.sourceDeck.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {deck.sourceDeck.name}
              </Link>
            </p>
          )}
          {deck.copiedFromDeck && (
            <p className="mt-2 text-sm">
              Copied from{" "}
              <Link
                href={`/decks/${deck.copiedFromDeck.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {deck.copiedFromDeck.name}
              </Link>
            </p>
          )}
          {canEdit && deck.colors === null && (
            <p className="mt-3 max-w-2xl rounded-lg border-2 border-dashed border-border bg-card/40 px-3 py-2 text-sm">
              This deck has no colors yet, so any card can be added.{" "}
              <Link
                href={`/decks/${deck.id}/edit`}
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Pick its colors
              </Link>
              {isCommanderFormat ? " or choose a commander to restrict it." : " to restrict it."}
            </p>
          )}
          {deck.notes && (
            <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
              {deck.notes}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
          <ExportDeckButton
            deckName={deck.name}
            commanderName={commander?.cardName ?? null}
            cards={allCards.map((card) => ({
              cardName: card.cardName,
              quantity: card.quantity,
              board: card.board,
            }))}
          />
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="max-sm:px-2 max-sm:tracking-normal!"
              render={<Link href={`/decks/${deck.id}/edit`} />}
            >
              <Settings2 data-icon="inline-start" />
              Settings
            </Button>
          )}
          {canEdit && <DeleteDeckButton deckId={deck.id} deckName={deck.name} />}
          {/* sourceDeck is null when the viewer can't see the source: then
              there's nothing to compare with, and its id stays out of the
              page (Cipher re-review N2). */}
          {deck.sourceDeck && (
            <Button
              size="sm"
              className="max-sm:px-2 max-sm:tracking-normal!"
              render={
                <Link
                  href={`/decks/${deck.sourceDeck.id}/compare?branch=${deck.id}`}
                />
              }
            >
              <GitCompareArrows data-icon="inline-start" />
              Compare
            </Button>
          )}
          {deck.copiedFromDeck && (
            <Button
              size="sm"
              className="max-sm:px-2 max-sm:tracking-normal!"
              aria-label="Compare to source"
              render={
                <Link
                  href={`/decks/${deck.copiedFromDeck.id}/compare?branch=${deck.id}`}
                />
              }
            >
              <GitCompareArrows data-icon="inline-start" />
              <span className="sm:hidden">Compare</span>
              <span className="hidden sm:inline">Compare source</span>
            </Button>
          )}
          {!deck.forkedFromId && defaultCompareId && (
            <Button
              size="sm"
              variant="outline"
              className="max-sm:px-2 max-sm:tracking-normal!"
              aria-label="Compare branch"
              render={
                <Link
                  href={`/decks/${deck.id}/compare?branch=${defaultCompareId}`}
                />
              }
            >
              <GitCompareArrows data-icon="inline-start" />
              <span className="sm:hidden">Compare</span>
              <span className="hidden sm:inline">Compare branch</span>
            </Button>
          )}
          {canFork && user && !rootForkLocked && (
            <ForkDeckForm deckId={deck.id} defaultName={defaultBranchName(deck.name)} />
          )}
          {rootForkLocked && (
            <p className="w-full text-sm text-muted-foreground sm:w-auto">{ORIGINAL_DECK_FORKS_LOCKED}</p>
          )}
          {canCopy && user && (
            <CopyDeckForm deckId={deck.id} defaultName={defaultCopyName(deck.name)} />
          )}
        </div>
      </div>

      {switcher && (
        <BranchSwitcher
          currentId={deck.id}
          options={switcher.options}
          diffHref={switcher.diffHref}
        />
      )}

      <div className="mt-4 min-w-0">
        <BoardSwitcher deckId={deck.id} current={board} counts={counts} />
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:mt-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-3 sm:p-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden">
          <h2 className="mb-3 text-xl font-semibold">
            Card search
          </h2>
          <CardSearch deckId={deck.id} canEdit={canEdit} deckColors={deck.colors} board={board} />
        </aside>
        <div className="min-w-0 space-y-8">
          {isCommanderFormat && (
            <CommanderSlot
              deckId={deck.id}
              commander={commander}
              canEdit={canEdit}
              alsoInDeckList={commanderAlsoInList}
              deckColors={deck.colors}
            />
          )}
          <section className="min-w-0 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5">
            <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h2 className="min-w-0 text-xl font-semibold">
                Deck list
              </h2>
              {canEdit && board === "main" && (
                <CategoryManager
                  deckId={deck.id}
                  cards={mainCards}
                  categories={deck.categories ?? []}
                  typeSectionOrders={deck.typeSectionOrders ?? []}
                />
              )}
            </div>
            <DeckList
              deckId={deck.id}
              cards={boardCards}
              categories={board === "main" ? (deck.categories ?? []) : []}
              typeSectionOrders={deck.typeSectionOrders ?? []}
              canEdit={canEdit}
              hasCommander={Boolean(commander)}
              board={board}
            />
          </section>
          <CommentSection
            deckId={deck.id}
            comments={comments}
            canComment={Boolean(user) && canComment}
          />
        </div>
      </div>
    </div>
  );
}
