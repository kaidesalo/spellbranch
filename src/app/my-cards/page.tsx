import Link from "next/link";
import { Compass, Import, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository } from "@/lib/data";
import { listMyBranches, listVisibleDecks } from "@/lib/queries/decks";
import { myCardsSection } from "@/lib/collection";
import { Button } from "@/components/ui/button";
import { BranchBadge, DeckEmpty, DeckGrid } from "@/components/decks/deck-grid";
import { CollectionPanel } from "@/components/collection/collection-panel";
import { cn } from "@/lib/utils";

function oneParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 80 ? "" : trimmed;
}

export default async function MyCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[]; q?: string | string[] }>;
}) {
  const user = await requireUser();
  const { section: sectionParam, q: queryParam } = await searchParams;
  const section = myCardsSection(Array.isArray(sectionParam) ? sectionParam[0] : sectionParam);
  const initialQuery = section === "collection" ? oneParam(queryParam) : "";
  const repo = getRepository();
  const [decks, branches, cards, visibility] = await Promise.all([
    listVisibleDecks("mine"),
    listMyBranches(),
    repo.listMyCollection(user.id),
    repo.getCollectionVisibility(user.id),
  ]);

  const tabs = [
    { id: "decks" as const, label: "Decks", count: decks.length, href: "/my-cards" },
    { id: "branches" as const, label: "Branches", count: branches.length, href: "/my-cards?section=branches" },
    { id: "collection" as const, label: "Collection", count: cards.length, href: "/my-cards?section=collection" },
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold">My cards</h1>
          <p className="mt-1 text-muted-foreground">
            Decks you made, branches you forked, and the cards you own.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 self-start sm:self-auto">
          <Button variant="outline" render={<Link href="/browse" />}>
            <Compass data-icon="inline-start" />
            Browse
          </Button>
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

      <nav
        aria-label="My cards"
        data-testid="my-cards-switcher"
        className="mt-6 grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-border/80 bg-card/70 p-1"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={section === tab.id ? "page" : undefined}
            data-testid={`my-cards-${tab.id}`}
            className={cn(
              "flex min-w-0 flex-col items-center rounded-lg px-1.5 py-2 text-center",
              section === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-secondary",
            )}
          >
            <span className="w-full truncate text-sm font-semibold">{tab.label}</span>
            <span
              className={cn(
                "text-xs font-medium tabular-nums",
                section === tab.id ? "text-primary-foreground/80" : "text-muted-foreground",
              )}
            >
              {tab.count}
            </span>
          </Link>
        ))}
      </nav>

      <div className="mt-6 min-w-0">
        {section === "decks" &&
          (decks.length === 0 ? (
            <DeckEmpty
              title="No decks yet"
              body="Create a deck, or import a list you already built on Moxfield or Archidekt. Copies of other people's decks show up here too."
              href="/decks/new"
              cta="Create deck"
              secondaryHref="/decks/import"
              secondaryCta="Import a list"
            />
          ) : (
            <DeckGrid decks={decks} />
          ))}
        {section === "branches" &&
          (branches.length === 0 ? (
            <DeckEmpty
              title="No branches yet"
              body="Fork a deck to try a change without editing the original. Branches you create are listed here."
            />
          ) : (
            <DeckGrid decks={branches} badge={<BranchBadge />} showSource />
          ))}
        {section === "collection" && (
          <CollectionPanel cards={cards} visibility={visibility} initialQuery={initialQuery} />
        )}
      </div>
    </div>
  );
}
