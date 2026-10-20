import "server-only";

import { requireUser } from "@/lib/auth/require-user";
import { getSessionUser } from "@/lib/auth/session";
import { readStore } from "@/lib/data/store";
import { toPublicProfile } from "@/lib/queries/profiles";
import {
  canCommentOnDeck,
  canEditDeck,
  canForkDeck,
  canViewDeck,
} from "@/lib/permissions";
import type { Deck, DeckWithMeta } from "@/lib/types";

// Read helpers for deck pages. Server-only (not "use server"), so none of
// these are callable as server actions; each re-checks permissions.

function publicProfile(store: Awaited<ReturnType<typeof readStore>>, id: string) {
  const u = store.users.find((x) => x.id === id);
  return u ? toPublicProfile(u) : undefined;
}

function decorateDeck(store: Awaited<ReturnType<typeof readStore>>, deck: Deck): DeckWithMeta {
  const cards = store.deckCards.filter((c) => c.deckId === deck.id);
  const branches = store.decks.filter((d) => d.forkedFromId === deck.id);
  const sourceDeck = deck.forkedFromId
    ? store.decks.find((d) => d.id === deck.forkedFromId) ?? null
    : null;

  return {
    ...deck,
    owner: publicProfile(store, deck.ownerId),
    cards,
    cardCount: cards.reduce((sum, c) => sum + c.quantity, 0),
    forkCount: branches.length,
    sourceDeck,
    branches,
  };
}

export async function listVisibleDecks(scope: "mine" | "friends" | "public" = "mine") {
  const user = await getSessionUser();
  const store = await readStore();

  let decks = store.decks.filter((d) => canViewDeck(store, d, user?.id ?? null));

  if (scope === "mine") {
    if (!user) return [];
    decks = decks.filter((d) => d.ownerId === user.id && !d.forkedFromId);
  } else if (scope === "friends") {
    if (!user) return [];
    decks = decks.filter(
      (d) =>
        d.ownerId !== user.id &&
        d.visibility === "friends" &&
        canViewDeck(store, d, user.id),
    );
  } else {
    decks = decks.filter((d) => d.visibility === "public" && !d.forkedFromId);
  }

  return decks
    .map((d) => decorateDeck(store, d))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listMyBranches() {
  const user = await requireUser();
  const store = await readStore();
  return store.decks
    .filter((d) => d.ownerId === user.id && d.forkedFromId)
    .map((d) => decorateDeck(store, d))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDeckById(deckId: string): Promise<DeckWithMeta | null> {
  const user = await getSessionUser();
  const store = await readStore();
  const deck = store.decks.find((d) => d.id === deckId);
  if (!deck) return null;
  if (!canViewDeck(store, deck, user?.id ?? null)) return null;
  return decorateDeck(store, deck);
}

export async function getCompareData(sourceId: string, branchId: string) {
  const user = await getSessionUser();
  const store = await readStore();
  const source = store.decks.find((d) => d.id === sourceId);
  const branch = store.decks.find((d) => d.id === branchId);

  if (!source || !branch) return null;
  if (!canViewDeck(store, source, user?.id ?? null)) return null;
  if (!canViewDeck(store, branch, user?.id ?? null)) return null;
  if (branch.forkedFromId !== source.id && source.forkedFromId !== branch.id) {
    // Allow comparing any fork with its direct source, either direction
    if (branch.forkedFromId !== source.id) return null;
  }

  return {
    source: decorateDeck(store, source),
    branch: decorateDeck(store, branch),
    canSetPreferred: Boolean(user && canEditDeck(source, user.id)),
  };
}

export async function canUserFork(deckId: string) {
  const user = await getSessionUser();
  const store = await readStore();
  const deck = store.decks.find((d) => d.id === deckId);
  if (!deck) return false;
  return canForkDeck(store, deck, user?.id ?? null);
}

export async function canUserEdit(deckId: string) {
  const user = await getSessionUser();
  const store = await readStore();
  const deck = store.decks.find((d) => d.id === deckId);
  if (!deck) return false;
  return canEditDeck(deck, user?.id ?? null);
}

export async function canUserComment(deckId: string) {
  const user = await getSessionUser();
  const store = await readStore();
  const deck = store.decks.find((d) => d.id === deckId);
  if (!deck) return false;
  return canCommentOnDeck(store, deck, user?.id ?? null);
}
