/**
 * The branch menu on a deck page: the source (when the viewer can see it)
 * plus the visible forks of that source. Built from data the repository
 * already filtered with can_view_deck. Compare links are omitted when the
 * source is hidden, so its id never reaches the page.
 */

export type BranchOption = {
  id: string;
  name: string;
  username: string | null;
  role: "source" | "branch" | "copy" | "original";
  preferred: boolean;
  /** Compare this branch to the source. Null for the source row, and for every row when the source is hidden. */
  diffHref: string | null;
  /**
   * Deck page for this row. Undefined uses `/decks/${id}`. Null means the
   * viewer may see the name and handle but not open the deck (its cards
   * stay hidden).
   */
  openHref?: string | null;
};

export type BranchSwitcherModel = {
  options: BranchOption[];
  /** One-tap diff for the deck currently open. Null when there is nothing visible to compare. */
  diffHref: string | null;
};

type Named = {
  id: string;
  name: string;
  owner?: { username: string } | null;
};

type SourceLike = Named & { preferredBranchId: string | null };

export type BranchSwitcherDeck = {
  id: string;
  name: string;
  forkedFromId: string | null;
  preferredBranchId: string | null;
  owner?: { username: string } | null;
  sourceDeck?: SourceLike | null;
  branches?: Named[];
  sourceBranches?: Named[];
  copyLinks?: Array<{
    id: string;
    name: string;
    username: string | null;
    role: "copy" | "original";
    visible: boolean;
  }>;
};

function compareHref(sourceId: string, branchId: string): string {
  return `/decks/${sourceId}/compare?branch=${branchId}`;
}

export function branchSwitcherModel(deck: BranchSwitcherDeck): BranchSwitcherModel | null {
  const isFork = Boolean(deck.forkedFromId);
  const branches = (isFork ? deck.sourceBranches : deck.branches) ?? [];
  const copyLinks = deck.copyLinks ?? [];
  if (!isFork && branches.length === 0 && copyLinks.length === 0) return null;

  const source: SourceLike | null = isFork
    ? (deck.sourceDeck ?? null)
    : {
        id: deck.id,
        name: deck.name,
        preferredBranchId: deck.preferredBranchId,
        owner: deck.owner,
      };
  if (isFork && !source && branches.length === 0 && copyLinks.length === 0) return null;

  const sourceId = source?.id ?? null;
  const visiblePreferred =
    source?.preferredBranchId && branches.some((b) => b.id === source.preferredBranchId)
      ? source.preferredBranchId
      : null;

  const options: BranchOption[] = [];
  if (source && sourceId) {
    options.push({
      id: source.id,
      name: source.name,
      username: source.owner?.username ?? null,
      role: "source",
      preferred: false,
      diffHref: null,
    });
  }

  const sorted = [...branches]
    .filter((b) => b.id !== sourceId)
    .sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
  for (const branch of sorted) {
    options.push({
      id: branch.id,
      name: branch.name,
      username: branch.owner?.username ?? null,
      role: "branch",
      preferred: branch.id === visiblePreferred,
      diffHref: sourceId ? compareHref(sourceId, branch.id) : null,
    });
  }

  const linked = [...copyLinks].sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === "original" ? -1 : 1) ||
      a.name.localeCompare(b.name, "en") ||
      a.id.localeCompare(b.id),
  );
  for (const link of linked) {
    options.push({
      id: link.id,
      name: link.name,
      username: link.username,
      role: link.role,
      preferred: false,
      // Compare only when the other deck's cards are already visible.
      diffHref: link.visible
        ? link.role === "copy"
          ? compareHref(deck.id, link.id)
          : compareHref(link.id, deck.id)
        : null,
      openHref: link.visible ? `/decks/${link.id}` : null,
    });
  }

  if (options.length === 0) return null;

  let diffHref: string | null = null;
  if (sourceId && isFork && deck.id !== sourceId) {
    diffHref = compareHref(sourceId, deck.id);
  } else if (sourceId && !isFork) {
    const target = visiblePreferred ?? sorted[0]?.id;
    if (target) diffHref = compareHref(sourceId, target);
  }

  return { options, diffHref };
}
