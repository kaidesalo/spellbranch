import Link from "next/link";
import { Import, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { listFriendBranchesOnMyDecks, listMyBranches, listVisibleDecks } from "@/lib/queries/decks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeckCardSummary } from "@/components/decks/deck-card-summary";

export default async function DecksPage() {
  await requireUser();
  const [mine, branches, friendBranches, friends, pub] = await Promise.all([
    listVisibleDecks("mine"),
    listMyBranches(),
    listFriendBranchesOnMyDecks(),
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
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <Button variant="outline" render={<Link href="/decks/import" />}>
            <Import data-icon="inline-start" />
            Import
          </Button>
          <Button render={<Link href="/decks/new" />}>
            <Plus data-icon="inline-start" />
            New deck
          </Button>
        </div>
      </div>

      <Tabs defaultValue="mine" className="mt-8 min-w-0">
        <TabsList className="max-sm:h-auto! max-sm:w-full max-sm:flex-wrap max-sm:justify-start max-sm:gap-1">
          <TabsTrigger className="max-sm:flex-none!" value="mine">Mine ({mine.length})</TabsTrigger>
          <TabsTrigger className="max-sm:flex-none!" value="branches">Branches ({branches.length})</TabsTrigger>
          <TabsTrigger className="max-sm:flex-none!" value="friends">Friends ({friends.length})</TabsTrigger>
          <TabsTrigger className="max-sm:flex-none!" value="public">Public ({pub.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {mine.length === 0 ? (
            <Empty
              title="No decks yet"
              body="Create a deck, or import a list you already built on Moxfield or Archidekt."
              href="/decks/new"
              cta="Create deck"
              secondaryHref="/decks/import"
              secondaryCta="Import a list"
            />
          ) : (
            <Grid decks={mine} />
          )}
        </TabsContent>
        <TabsContent value="branches" className="mt-4 space-y-8">
          {branches.length === 0 && friendBranches.length === 0 ? (
            <Empty
              title="No branches yet"
              body="Fork a friend's deck (or your own) to experiment safely."
            />
          ) : (
            <>
              {branches.length > 0 && (
                <section>
                  <h2 className="mb-4 font-heading text-xl font-semibold">Your branches</h2>
                  <Grid
                    decks={branches}
                    badge={<Badge variant="secondary">Branch</Badge>}
                  />
                </section>
              )}
              {friendBranches.length > 0 && (
                <section>
                  <h2 className="mb-1 font-heading text-xl font-semibold">
                    Friend branches on your decks
                  </h2>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Forks your friends made of decks you own. These are not branches you created.
                  </p>
                  <Grid
                    decks={friendBranches}
                    showSource
                    badge={<Badge variant="secondary">Friend branch</Badge>}
                  />
                </section>
              )}
            </>
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
  showSource = false,
}: {
  decks: Awaited<ReturnType<typeof listVisibleDecks>>;
  badge?: React.ReactNode;
  showSource?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((deck) => (
        <DeckCardSummary key={deck.id} deck={deck} badge={badge} showSource={showSource} />
      ))}
    </div>
  );
}

function Empty({
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
          {href && cta && (
            <Button render={<Link href={href} />}>{cta}</Button>
          )}
          {secondaryHref && secondaryCta && (
            <Button variant="outline" render={<Link href={secondaryHref} />}>
              {secondaryCta}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
