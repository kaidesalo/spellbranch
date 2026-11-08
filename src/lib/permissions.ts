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
  // deck may view a friend's fork, including a private one (review F4).
  // Look up the source row directly. Do not call canViewDeck on it.
  if (!deck.forkedFromId) return false;
  const source = store.decks.find((d) => d.id === deck.forkedFromId);
  return Boolean(
    source &&
      source.ownerId === viewerId &&
      areFriends(store.friendships, deck.ownerId, viewerId),
  );
}

export function canEditDeck(deck: Deck, userId: string | null): boolean {
  return Boolean(userId && deck.ownerId === userId);
}

export function canCommentOnDeck(
  store: DataStore,
  deck: Deck,
  userId: string | null,
): boolean {
  return canViewDeck(store, deck, userId);
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
