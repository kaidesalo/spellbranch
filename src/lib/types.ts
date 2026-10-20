export type DeckFormat =
  | "commander"
  | "standard"
  | "modern"
  | "pioneer"
  | "legacy"
  | "pauper"
  | "casual";

export type Visibility = "private" | "friends" | "public";

export type FriendshipStatus = "pending" | "accepted" | "declined";

/**
 * Another user's profile as the UI sees it. Deliberately has no `email`:
 * only the signed-in user's own SessionUser carries an email address.
 */
export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
}

export interface FavoriteCard {
  id: string;
  userId: string;
  scryfallId: string;
  cardName: string;
  imageUri: string | null;
  manaCost: string | null;
  typeLine: string | null;
  createdAt: string;
}

export interface DeckCard {
  id: string;
  deckId: string;
  scryfallId: string;
  cardName: string;
  imageUri: string | null;
  manaCost: string | null;
  typeLine: string;
  colors: string[];
  oracleText: string | null;
  quantity: number;
  createdAt: string;
}

export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  format: DeckFormat;
  notes: string;
  visibility: Visibility;
  allowForks: boolean;
  forkedFromId: string | null;
  preferredBranchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  deckId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
}

export interface DeckWithMeta extends Deck {
  owner?: PublicProfile;
  cards?: DeckCard[];
  cardCount?: number;
  forkCount?: number;
  sourceDeck?: Deck | null;
  branches?: Deck[];
}

export type DiffKind = "added" | "removed" | "quantity" | "unchanged";

export interface CardDiff {
  scryfallId: string;
  cardName: string;
  imageUri: string | null;
  typeLine: string;
  manaCost: string | null;
  sourceQty: number;
  branchQty: number;
  kind: DiffKind;
}

export const DECK_FORMATS: { value: DeckFormat; label: string }[] = [
  { value: "commander", label: "Commander" },
  { value: "standard", label: "Standard" },
  { value: "modern", label: "Modern" },
  { value: "pioneer", label: "Pioneer" },
  { value: "legacy", label: "Legacy" },
  { value: "pauper", label: "Pauper" },
  { value: "casual", label: "Casual" },
];

export const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "friends", label: "Friends only" },
  { value: "public", label: "Public" },
];
