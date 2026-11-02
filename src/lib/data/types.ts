import type {
  Comment,
  DeckCommander,
  DeckFormat,
  DeckWithMeta,
  FavoriteCard,
  Friendship,
  OwnProfile,
  PublicProfile,
  Visibility,
} from "@/lib/types";

/**
 * The data layer both backends implement (src/lib/data/local.ts,
 * src/lib/data/supabase.ts). Pick one with getRepository() (index.ts).
 *
 * Every method takes the caller's user id (from getSessionUser/requireUser,
 * never from the client). The local adapter enforces permissions in app code
 * (src/lib/permissions.ts); the Supabase adapter relies on RLS through the
 * request-scoped client and only adds filters for clarity/UX.
 *
 * Mutations throw DataError with a message that is safe to show the user;
 * anything else is unexpected and actions show a generic message instead.
 */

export type DeckScope = "mine" | "friends" | "public";

export interface DeckInput {
  name: string;
  format: DeckFormat;
  notes: string;
  visibility: Visibility;
  allowForks: boolean;
}

export interface CardInput {
  scryfallId: string;
  cardName: string;
  imageUri: string | null;
  manaCost: string | null;
  typeLine: string;
  colors: string[];
  oracleText: string | null;
  quantity: number;
}

export interface FavoriteInput {
  scryfallId: string;
  cardName: string;
  imageUri: string | null;
  manaCost: string | null;
  typeLine: string | null;
}

export interface CommentWithAuthor extends Comment {
  author: { id: string; username: string; displayName: string } | null;
}

export interface FriendRow {
  friendship: Friendship;
  profile: PublicProfile;
}

export interface FriendsData {
  friends: FriendRow[];
  incoming: FriendRow[];
  outgoing: FriendRow[];
}

export interface CompareData {
  source: DeckWithMeta;
  branch: DeckWithMeta;
  canSetPreferred: boolean;
}

export interface DeckPermissions {
  canEdit: boolean;
  canFork: boolean;
  canComment: boolean;
}

export interface Repository {
  // Decks (reads)
  listDecks(viewerId: string | null, scope: DeckScope): Promise<DeckWithMeta[]>;
  listMyBranches(userId: string): Promise<DeckWithMeta[]>;
  getDeck(viewerId: string | null, deckId: string): Promise<DeckWithMeta | null>;
  getCompareData(
    viewerId: string | null,
    sourceId: string,
    branchId: string,
  ): Promise<CompareData | null>;
  getDeckPermissions(viewerId: string | null, deckId: string): Promise<DeckPermissions>;

  // Decks (writes)
  createDeck(userId: string, input: DeckInput): Promise<string>;
  /** Changing the format away from "commander" clears the commander. */
  updateDeck(userId: string, deckId: string, input: DeckInput): Promise<void>;
  deleteDeck(userId: string, deckId: string): Promise<void>;
  addCard(userId: string, deckId: string, card: CardInput): Promise<void>;
  /** quantity 0 removes the card. */
  setCardQuantity(userId: string, deckId: string, cardId: string, quantity: number): Promise<void>;
  /**
   * Owner only, Commander decks only. `commander` must already be built from
   * Scryfall data (commanderFromScryfall); null clears it. Both adapters
   * re-check the legendary-creature rule, and the database CHECKs it again.
   */
  setCommander(userId: string, deckId: string, commander: DeckCommander | null): Promise<void>;
  /** Copies cards and the commander (forks carry the commander over). */
  forkDeck(userId: string, deckId: string): Promise<string>;
  setPreferredBranch(userId: string, sourceId: string, branchId: string | null): Promise<void>;

  // Comments
  listComments(viewerId: string | null, deckId: string): Promise<CommentWithAuthor[]>;
  addComment(userId: string, deckId: string, body: string): Promise<void>;

  // Favorites
  listFavorites(userId: string): Promise<FavoriteCard[]>;
  addFavorite(userId: string, input: FavoriteInput): Promise<void>;
  removeFavorite(userId: string, favoriteId: string): Promise<void>;

  // Friends
  getFriendsData(userId: string): Promise<FriendsData>;
  /** Exact, case-insensitive username match. 0 or 1 results; never yourself. */
  findProfile(userId: string, username: string): Promise<PublicProfile[]>;
  sendFriendRequest(userId: string, addresseeId: string): Promise<void>;
  /** Addressee only, pending requests only. */
  respondFriendRequest(userId: string, friendshipId: string, accept: boolean): Promise<void>;
  /** Requester: cancel (pending) or unfriend (accepted). Addressee: any row. */
  removeFriendship(userId: string, friendshipId: string): Promise<void>;

  // Profile
  getOwnProfile(userId: string): Promise<OwnProfile | null>;
}
