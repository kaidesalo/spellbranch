import Link from "next/link";
import { GitBranch, Import, Plus } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { listPreconPage, listVisibleDecks } from "@/lib/queries/decks";
import { preconListHref } from "@/lib/precons/browse";
import { DeckEmpty, DeckGrid } from "@/components/decks/deck-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type DecksTab = "mine" | "public" | "precons";

/** Public is the signed-out default. My decks is the signed-in default. */
export function decksTab(value: unknown, signedIn: boolean): DecksTab {
  if (value === "public") return "public";
  if (value === "precons") return "precons";
  if (value === "mine") return "mine";
  return signedIn ? "mine" : "public";
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number(one(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function DecksPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    q?: string | string[];
    year?: string | string[];
    set?: string | string[];
    page?: string | string[];
  }>;
}) {
  const user = await getSessionUser();
  const params = await searchParams;
  const requested = one(params.tab);
  const tab = decksTab(requested, Boolean(user));
  const q = one(params.q);
  const year = one(params.year);
  const set = one(params.set);
  const page = pageNumber(params.page);
  const [mine, pub, precons] = await Promise.all([
    user ? listVisibleDecks("mine") : Promise.resolve([]),
    listVisibleDecks("public"),
    listPreconPage(
      tab === "precons" ? { q, year, set, page } : { summaryOnly: true },
    ),
  ]);
  const signInHref = `/login?next=${encodeURIComponent(safeNextPath("/decks"))}`;

  const tabs = [
    { id: "mine" as const, label: "My decks", count: user ? mine.length : null, href: "/decks" },
    { id: "public" as const, label: "Public decks", count: pub.length, href: "/decks?tab=public" },
    { id: "precons" as const, label: "Precons", count: precons.catalogTotal, href: "/decks?tab=precons" },
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
            <Button variant="outline" render={<Link href="/my-cards?section=branches" />}>
              <GitBranch data-icon="inline-start" />
              Branches
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
        )}
      </div>

      <nav
        aria-label="Decks"
        data-testid="decks-switcher"
        className="mt-6 grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-border/80 bg-card/70 p-1"
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
        {tab === "precons" && (
          <PreconBrowser
            q={q}
            year={year}
            set={set}
            page={precons.page}
            pageCount={precons.pageCount}
            total={precons.total}
            catalogTotal={precons.catalogTotal}
            years={precons.years}
            sets={precons.sets}
            decks={precons.decks}
          />
        )}
      </div>
    </div>
  );
}

function PreconBrowser({
  q,
  year,
  set,
  page,
  pageCount,
  total,
  catalogTotal,
  years,
  sets,
  decks,
}: {
  q: string;
  year: string;
  set: string;
  page: number;
  pageCount: number;
  total: number;
  catalogTotal: number;
  years: string[];
  sets: string[];
  decks: Awaited<ReturnType<typeof listPreconPage>>["decks"];
}) {
  const filters = { q, year, set };
  const fieldClass =
    "h-11 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <div className="min-w-0">
      <form
        action="/decks"
        data-testid="precon-filters"
        className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_8rem_8rem_auto] lg:items-end"
      >
        <input type="hidden" name="tab" value="precons" />
        <label className="min-w-0 text-sm">
          <span className="mb-1 block text-muted-foreground">Search precons</span>
          <Input name="q" defaultValue={q} placeholder="Name, commander, or set" aria-label="Search precons" className="h-11" />
        </label>
        <label className="min-w-0 text-sm">
          <span className="mb-1 block text-muted-foreground">Year</span>
          <select name="year" defaultValue={year} aria-label="Filter precons by year" className={fieldClass}>
            <option value="">All years</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          <span className="mb-1 block text-muted-foreground">Set</span>
          <select name="set" defaultValue={set.toUpperCase()} aria-label="Filter precons by set" className={fieldClass}>
            <option value="">All sets</option>
            {sets.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" className="h-11">
          Apply
        </Button>
      </form>

      <div className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {total === catalogTotal
            ? `${catalogTotal} official Commander precons`
            : `${total} of ${catalogTotal} official Commander precons`}
        </p>
        <PreconPager page={page} pageCount={pageCount} filters={filters} />
      </div>

      {decks.length === 0 ? (
        <div className="mt-6">
          <DeckEmpty
            title={catalogTotal === 0 ? "No precons yet" : "No precons match"}
            body={
              catalogTotal === 0
                ? "Official Commander precons show up here once they are loaded."
                : "Try another year, set, or name."
            }
            href={catalogTotal === 0 ? undefined : preconListHref({})}
            cta={catalogTotal === 0 ? undefined : "Clear filters"}
          />
        </div>
      ) : (
        <div className="mt-6">
          <DeckGrid decks={decks} />
        </div>
      )}
    </div>
  );
}

function PreconPager({
  page,
  pageCount,
  filters,
}: {
  page: number;
  pageCount: number;
  filters: { q: string; year: string; set: string };
}) {
  if (pageCount <= 1) return null;
  const linkClass =
    "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav aria-label="Precon pages" data-testid="precon-pagination" className="flex items-center gap-2">
      {page > 1 ? (
        <Link href={preconListHref({ ...filters, page: page - 1 })} className={cn(linkClass, "bg-secondary text-foreground")}>
          Previous
        </Link>
      ) : (
        <span className={cn(linkClass, "text-muted-foreground")}>Previous</span>
      )}
      <span className="min-w-24 text-center text-sm tabular-nums text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={preconListHref({ ...filters, page: page + 1 })} className={cn(linkClass, "bg-secondary text-foreground")}>
          Next
        </Link>
      ) : (
        <span className={cn(linkClass, "text-muted-foreground")}>Next</span>
      )}
    </nav>
  );
}
