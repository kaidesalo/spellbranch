import Link from "next/link";
import { GitBranch, Layers3, Plus, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { listMyBranches, listVisibleDecks } from "@/lib/queries/decks";
import { getFriendsData } from "@/lib/queries/friends";
import { getRequestedUsername } from "@/lib/auth/session";
import { usernameChangedNotice } from "@/lib/auth/username-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeckCardSummary } from "@/components/decks/deck-card-summary";

export default async function DashboardPage() {
  const user = await requireUser();
  const [decks, branches, friendsData, requestedUsername] = await Promise.all([
    listVisibleDecks("mine"),
    listMyBranches(),
    getFriendsData(),
    getRequestedUsername(),
  ]);
  const usernameNotice = usernameChangedNotice(requestedUsername, user.username);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Hey, {user.displayName}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Your decks, branches, and friend activity in one place.
          </p>
        </div>
        <Button render={<Link href="/decks/new" />}>
          <Plus data-icon="inline-start" />
          New deck
        </Button>
      </div>

      {usernameNotice && (
        <Alert className="mt-6" data-testid="username-notice">
          <AlertDescription>
            {usernameNotice}{" "}
            <Link href="/profile" className="font-medium text-primary underline-offset-4 hover:underline">
              View profile
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/80 bg-card/70 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers3 className="h-4 w-4" /> Decks
          </div>
          <p className="mt-2 font-heading text-3xl font-semibold">{decks.length}</p>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card/70 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranch className="h-4 w-4" /> Branches
          </div>
          <p className="mt-2 font-heading text-3xl font-semibold">{branches.length}</p>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card/70 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" /> Friends
          </div>
          <p className="mt-2 font-heading text-3xl font-semibold">
            {friendsData.friends.length}
          </p>
        </div>
      </div>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-xl font-semibold">Your decks</h2>
          <Button variant="ghost" size="sm" render={<Link href="/decks" />}>
            View all
          </Button>
        </div>
        {decks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
            <p className="font-medium">No decks yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first list and start searching Scryfall.
            </p>
            <Button className="mt-4" render={<Link href="/decks/new" />}>
              Create a deck
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.slice(0, 6).map((deck) => (
              <DeckCardSummary key={deck.id} deck={deck} />
            ))}
          </div>
        )}
      </section>

      {branches.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-heading text-xl font-semibold">Your branches</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {branches.slice(0, 3).map((deck) => (
              <DeckCardSummary
                key={deck.id}
                deck={deck}
                badge={<Badge variant="secondary">Branch</Badge>}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
