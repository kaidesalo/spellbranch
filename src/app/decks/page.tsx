import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { listMyBranches, listVisibleDecks } from "@/lib/queries/decks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeckCardSummary } from "@/components/decks/deck-card-summary";

export default async function DecksPage() {
  await requireUser();
  const [mine, branches, friends, pub] = await Promise.all([
    listVisibleDecks("mine"),
    listMyBranches(),
    listVisibleDecks("friends"),
    listVisibleDecks("public"),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold">Decks</h1>
          <p className="mt-1 text-muted-foreground">
            Your lists, forks, and decks shared with friends.
          </p>
        </div>
        <Button render={<Link href="/decks/new" />}>
          <Plus data-icon="inline-start" />
          New deck
        </Button>
      </div>

      <Tabs defaultValue="mine" className="mt-8">
        <TabsList>
          <TabsTrigger value="mine">Mine ({mine.length})</TabsTrigger>
          <TabsTrigger value="branches">Branches ({branches.length})</TabsTrigger>
          <TabsTrigger value="friends">Friends ({friends.length})</TabsTrigger>
          <TabsTrigger value="public">Public ({pub.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {mine.length === 0 ? (
            <Empty
              title="No decks yet"
              body="Create a deck to start searching Scryfall and building a list."
              href="/decks/new"
              cta="Create deck"
            />
          ) : (
            <Grid decks={mine} />
          )}
        </TabsContent>
        <TabsContent value="branches" className="mt-4">
          {branches.length === 0 ? (
            <Empty
              title="No branches yet"
              body="Fork a friend's deck (or your own) to experiment safely."
            />
          ) : (
            <Grid
              decks={branches}
              badge={<Badge variant="secondary">Branch</Badge>}
            />
          )}
        </TabsContent>
        <TabsContent value="friends" className="mt-4">
          {friends.length === 0 ? (
            <Empty
              title="No friend decks visible"
              body="Add friends and ask them to share decks as friends-only."
              href="/friends"
              cta="Find friends"
            />
          ) : (
            <Grid decks={friends} />
          )}
        </TabsContent>
        <TabsContent value="public" className="mt-4">
          {pub.length === 0 ? (
            <Empty
              title="No public decks yet"
              body="When someone sets a deck to public, it will show up here."
            />
          ) : (
            <Grid decks={pub} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Grid({
  decks,
  badge,
}: {
  decks: Awaited<ReturnType<typeof listVisibleDecks>>;
  badge?: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((deck) => (
        <DeckCardSummary key={deck.id} deck={deck} badge={badge} />
      ))}
    </div>
  );
}

function Empty({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {href && cta && (
        <Button className="mt-4" render={<Link href={href} />}>
          {cta}
        </Button>
      )}
    </div>
  );
}
