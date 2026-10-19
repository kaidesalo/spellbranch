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
  if (deck.visibility === "friends") {
    return areFriends(store.friendships, deck.ownerId, viewerId);
  }
  return false;
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
