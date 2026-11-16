import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { listFriendBranchesOnMyDecks, listVisibleDecks } from "@/lib/queries/decks";
import { browseScope } from "@/lib/collection";
import { DeckEmpty, DeckGrid, FriendBranchBadge } from "@/components/decks/deck-grid";
import { cn } from "@/lib/utils";

export default async function BrowseDecksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const user = await getSessionUser();
  const { scope: scopeParam } = await searchParams;
  const requested = browseScope(Array.isArray(scopeParam) ? scopeParam[0] : scopeParam);
  // Signed-out visitors only get the public list. Friends and "on your decks"
  // stay behind a session so those queries are never run for anon.
  const scope = user ? requested : "public";
  const pub = await listVisibleDecks("public");
  const friends = user && scope === "friends" ? await listVisibleDecks("friends") : [];
  const onMine = user && scope === "on-mine" ? await listFriendBranchesOnMyDecks() : [];

  const tabs = [
    { id: "friends" as const, label: "Friends", count: friends.length, href: "/browse" },
    { id: "public" as const, label: "Public", count: pub.length, href: "/browse?scope=public" },
    { id: "on-mine" as const, label: "On your decks", count: onMine.length, href: "/browse?scope=on-mine" },
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold">Browse decks</h1>
        <p className="mt-1 text-muted-foreground">
          {user
            ? "Decks friends shared, public decks, and branches friends made of decks you own."
            : "Public decks anyone can open. Sign in to see decks friends shared."}
        </p>
      </div>
      {user && (
      <nav
        aria-label="Browse decks"
        className="mt-6 grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-border/80 bg-card/70 p-1"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={scope === tab.id ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-col items-center rounded-lg px-1.5 py-2 text-center",
              scope === tab.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary",
            )}
          >
            <span className="w-full truncate text-sm font-semibold">{tab.label}</span>
            <span
              className={cn(
                "text-xs font-medium tabular-nums",
                scope === tab.id ? "text-primary-foreground/80" : "text-muted-foreground",
              )}
            >
              {tab.count}
            </span>
          </Link>
        ))}
      </nav>
      )}
      <div className="mt-6 min-w-0">
        {scope === "friends" &&
          (friends.length === 0 ? (
            <DeckEmpty
              title="No friend decks visible"
              body="Add friends and ask them to share decks as friends-only."
              href="/friends"
              cta="Find friends"
            />
          ) : (
            <DeckGrid decks={friends} />
          ))}
        {scope === "public" &&
          (pub.length === 0 ? (
            <DeckEmpty title="No public decks yet" body="When someone sets a deck to public, it will show up here." />
          ) : (
            <DeckGrid decks={pub} />
          ))}
        {scope === "on-mine" &&
          (onMine.length === 0 ? (
            <DeckEmpty
              title="No friend branches on your decks"
              body="When a friend forks a deck you own, and you can see that fork, it shows up here."
            />
          ) : (
            <DeckGrid decks={onMine} showSource badge={<FriendBranchBadge />} />
          ))}
      </div>
    </div>
  );
}
