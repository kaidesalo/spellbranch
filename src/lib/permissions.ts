import type { DataStore } from "@/lib/data/store";
import type { Deck, Friendship, Visibility } from "@/lib/types";

export function areFriends(
  friendships: Friendship[],
  userA: string,
  userB: string,
): boolean {
  return friendships.some(
    (f) =>
      f.status === "accepted" &&
      ((f.requesterId === userA && f.addresseeId === userB) ||
        (f.requesterId === userB && f.addresseeId === userA)),
  );
}

export function canViewDeck(
  store: DataStore,
  deck: Deck,
  viewerId: string | null,
): boolean {
  if (deck.visibility === "public") return true;
  if (!viewerId) return false;
  if (deck.ownerId === viewerId) return true;
  if (
    deck.visibility === "friends" &&
    areFriends(store.friendships, deck.ownerId, viewerId)
  ) {
    return true;
  }
  // Same extra case as public.can_view_deck (009): the owner of the source
  // deck may view every direct fork, including a private fork by someone
  // who is not a friend. One lookup of that source row. Do not call
  // canViewDeck on it, and do not walk to grandchildren.
  if (!deck.forkedFromId) return false;
  const source = store.decks.find((d) => d.id === deck.forkedFromId);
  return Boolean(source && source.ownerId === viewerId);
}

export function canEditDeck(deck: Deck, userId: string | null): boolean {
  return Boolean(userId && deck.ownerId === userId);
}

/**
 * Pre-009 visibility (public.can_comment_on_deck). Seeing a fork because you
 * own its source does not let you comment on it.
 */
export function canCommentOnDeck(
  store: DataStore,
  deck: Deck,
  userId: string | null,
): boolean {
  if (deck.visibility === "public") return true;
  if (!userId) return false;
  if (deck.ownerId === userId) return true;
  if (deck.visibility === "friends") {
    return areFriends(store.friendships, deck.ownerId, userId);
  }
  return false;
}

export function canForkDeck(
  store: DataStore,
  deck: Deck,
  userId: string | null,
): boolean {
  if (!userId) return false;
  if (deck.ownerId === userId) return true;
  if (!deck.allowForks) return false;
  return canViewDeck(store, deck, userId);
}

export function visibilityLabel(visibility: Visibility): string {
  switch (visibility) {
    case "private":
      return "Private";
    case "friends":
      return "Friends only";
    case "public":
      return "Public";
  }
}
