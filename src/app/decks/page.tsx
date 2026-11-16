import Link from "next/link";
import { Import, Plus } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { listVisibleDecks } from "@/lib/queries/decks";
import { DeckEmpty, DeckGrid } from "@/components/decks/deck-grid";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DecksTab = "mine" | "public";

/** Public is the signed-out default. My decks is the signed-in default. */
export function decksTab(value: unknown, signedIn: boolean): DecksTab {
  if (value === "public") return "public";
  if (value === "mine") return "mine";
  return signedIn ? "mine" : "public";
}

export default async function DecksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const user = await getSessionUser();
  const { tab: tabParam } = await searchParams;
  const requested = Array.isArray(tabParam) ? tabParam[0] : tabParam;
  const tab = decksTab(requested, Boolean(user));
  const [mine, pub] = await Promise.all([
    user ? listVisibleDecks("mine") : Promise.resolve([]),
    listVisibleDecks("public"),
  ]);
  const signInHref = `/login?next=${encodeURIComponent(safeNextPath("/decks"))}`;

  const tabs = [
    { id: "mine" as const, label: "My decks", count: user ? mine.length : null, href: "/decks" },
    { id: "public" as const, label: "Public decks", count: pub.length, href: "/decks?tab=public" },
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold">Decks</h1>
          <p className="mt-1 text-muted-foreground">
            {user ? "Decks you made, and public decks anyone can open." : "Public decks anyone can open."}
          </p>
        </div>
        {user && (
          <div className="flex min-w-0 flex-wrap gap-2 self-start sm:self-auto">
            <Button variant="outline" render={<Link href="/decks/import" />}>
              <Import data-icon="inline-start" />
              Import
            </Button>
            <Button render={<Link href="/decks/new" />}>
              <Plus data-icon="inline-start" />
              New deck
            </Button>
          </div>
        )}
      </div>

      <nav
        aria-label="Decks"
        data-testid="decks-switcher"
        className="mt-6 grid min-w-0 grid-cols-2 gap-1 rounded-xl border border-border/80 bg-card/70 p-1"
      >
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={tab === item.id ? "page" : undefined}
            data-testid={`decks-${item.id}`}
            className={cn(
              "flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg px-1.5 py-2 text-center",
              tab === item.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary",
            )}
          >
            <span className="w-full truncate text-sm font-semibold">{item.label}</span>
            {item.count !== null && (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  tab === item.id ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="mt-6 min-w-0">
        {tab === "mine" && !user && (
          <DeckEmpty
            title="Sign in to see your decks"
            body="Your own decks stay private until you choose to share them."
            href={signInHref}
            cta="Sign in"
          />
        )}
        {tab === "mine" && user &&
          (mine.length === 0 ? (
            <DeckEmpty
              title="No decks yet"
              body="Create a deck, or import a list you already built on Moxfield or Archidekt."
              href="/decks/new"
              cta="Create deck"
              secondaryHref="/decks/import"
              secondaryCta="Import a list"
            />
          ) : (
            <DeckGrid decks={mine} />
          ))}
        {tab === "public" &&
          (pub.length === 0 ? (
            <DeckEmpty title="No public decks yet" body="When someone sets a deck to public, it will show up here." />
          ) : (
            <DeckGrid decks={pub} />
          ))}
      </div>
    </div>
  );
}
