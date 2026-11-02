import Link from "next/link";
import { notFound } from "next/navigation";
import { GitBranch, GitCompareArrows, Settings2 } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { forkDeckAction } from "@/lib/actions/decks";
import { getDeckById, getDeckPermissions } from "@/lib/queries/decks";
import { listComments } from "@/lib/queries/comments";
import { visibilityLabel } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardSearch } from "@/components/cards/card-search";
import { DeckList } from "@/components/decks/deck-list";
import { CommanderSlot } from "@/components/decks/commander-slot";
import { deckCountLabel } from "@/lib/commander";
import { CommentSection } from "@/components/comments/comment-section";
import { DeckColorsBadge } from "@/components/decks/deck-colors";

export default async function DeckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deck = await getDeckById(id);
  if (!deck) notFound();

  const user = await getSessionUser();
  const [{ canEdit, canFork, canComment }, comments] = await Promise.all([
    getDeckPermissions(id),
    listComments(id),
  ]);

  // Only branches the viewer can see are in deck.branches. If the preferred
  // branch isn't one of them, fall back to the first visible branch (or no
  // Compare link at all) instead of linking to a 404 (review L1).
  const preferred = deck.preferredBranchId
    ? deck.branches?.find((b) => b.id === deck.preferredBranchId)
    : undefined;
  const defaultCompareId = preferred?.id ?? deck.branches?.[0]?.id;

  // The commander is its own slot, not a deck-list entry (it isn't one of
  // the 99). Only Commander decks show the slot.
  const isCommanderFormat = deck.format === "commander";
  const commander = isCommanderFormat ? deck.commander : null;
  const commanderAlsoInList = Boolean(
    commander &&
      deck.cards?.some(
        (c) => c.scryfallId === commander.scryfallId || c.cardName === commander.cardName,
      ),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              {deck.name}
            </h1>
            {deck.forkedFromId && <Badge variant="secondary">Branch</Badge>}
            {preferred && <Badge>Preferred: {preferred.name}</Badge>}
          </div>
          <p className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {deck.format}
            </Badge>
            {deck.colors && <DeckColorsBadge colors={deck.colors} />}
            <Badge variant="secondary">{visibilityLabel(deck.visibility)}</Badge>
            <span>
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
          {canEdit && deck.colors === null && (
            <p className="mt-3 max-w-2xl rounded-lg border-2 border-dashed border-[#4b3d44]/60 bg-[#d2c9a5]/40 px-3 py-2 text-sm">
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

        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/decks/${deck.id}/edit`} />}
            >
              <Settings2 data-icon="inline-start" />
              Settings
            </Button>
          )}
          {canFork && user && (
            <form
              action={async () => {
                "use server";
                await forkDeckAction(deck.id);
              }}
            >
              <Button type="submit" size="sm" variant="outline">
                <GitBranch data-icon="inline-start" />
                Fork deck
              </Button>
            </form>
          )}
          {/* sourceDeck is null when the viewer can't see the source: then
              there's nothing to compare with, and its id stays out of the
              page (Cipher re-review N2). */}
          {deck.sourceDeck && (
            <Button
              size="sm"
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
          {!deck.forkedFromId && defaultCompareId && (
            <Button
              size="sm"
              variant="outline"
              render={
                <Link
                  href={`/decks/${deck.id}/compare?branch=${defaultCompareId}`}
                />
              }
            >
              <GitCompareArrows data-icon="inline-start" />
              Compare branch
            </Button>
          )}
        </div>
      </div>

      {!deck.forkedFromId && (deck.branches?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-xl border border-border/70 bg-card/60 px-4 py-3">
          <p className="text-sm font-medium">Branches</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {deck.branches!.map((branch) => (
              <li key={branch.id}>
                <Link
                  href={`/decks/${branch.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:border-primary/40"
                >
                  <GitBranch className="h-3.5 w-3.5 text-primary" />
                  {branch.name}
                  {preferred?.id === branch.id && (
                    <Badge className="ml-1">Preferred</Badge>
                  )}
                </Link>
                <Link
                  href={`/decks/${deck.id}/compare?branch=${branch.id}`}
                  className="ml-1 text-xs text-primary underline-offset-4 hover:underline"
                >
                  diff
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr] xl:grid-cols-[380px_1fr]">
        <aside className="rounded-2xl border border-border/80 bg-card/70 p-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden">
          <h2 className="mb-3 font-heading text-xl">
            Card search
          </h2>
          <CardSearch deckId={deck.id} canEdit={canEdit} deckColors={deck.colors} />
        </aside>
        <div className="space-y-8">
          {isCommanderFormat && (
            <CommanderSlot
              deckId={deck.id}
              commander={commander}
              canEdit={canEdit}
              alsoInDeckList={commanderAlsoInList}
              deckColors={deck.colors}
            />
          )}
          <section className="rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-5">
            <h2 className="mb-4 font-heading text-xl">
              Deck list
            </h2>
            <DeckList
              deckId={deck.id}
              cards={deck.cards ?? []}
              canEdit={canEdit}
              hasCommander={Boolean(commander)}
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
