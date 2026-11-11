import type { DeckBoard } from "@/lib/deck-boards";
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
  VisibleProfile,
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
  /**
   * Deck colors (src/lib/deck-colors.ts). createDeck: null/undefined stores
   * no colors. updateDeck: null/undefined leaves them as they are; an array
   * replaces them, and is refused (DeckColorError) if any card or the
   * commander wouldn't fit. Nothing is ever removed to make them fit.
   */
  colors?: string[] | null;
}

export interface CardInput {
  scryfallId: string;
  cardName: string;
  imageUri: string | null;
  manaCost: string | null;
  typeLine: string;
  colors: string[];
  /** Scryfall color identity; the adapters refuse a card outside the deck colors. */
  colorIdentity: string[];
  oracleText: string | null;
  quantity: number;
  /**
   * Which board to add to. Omitted means mainboard. Adding to side or maybe
   * skips the deck-color check; the same printing may already be on another
   * board and is a separate row.
   */
  board?: DeckBoard;
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

/** Profile page: the visible profile plus the decks this viewer may see. */
export interface UserProfileView {
  profile: VisibleProfile;
  decks: DeckWithMeta[];
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
  /** True when `branch` is an independent copy of `source`, not a branch of it. */
  copy: boolean;
}

export interface DeckPermissions {
  canEdit: boolean;
  /**
   * Fork is allowed: the caller may fork this deck, and, when it is a
   * branch, they may also fork the original deck (they can see it, and they
   * own it or it still allows forks).
   */
  canFork: boolean;
  /** Copy uses only this deck's own rule (owner, or allow_forks and visible). */
  canCopy: boolean;
  canComment: boolean;
}

export interface Repository {
  // Decks (reads)
  listDecks(viewerId: string | null, scope: DeckScope): Promise<DeckWithMeta[]>;
  /** Forks this user created. Not forks other people made of their decks. */
  listMyBranches(userId: string): Promise<DeckWithMeta[]>;
  /**
   * Forks of decks `userId` owns, made by their friends, that `userId` can
   * see (including a private fork). Not listMyBranches.
   */
  listFriendBranchesOnMyDecks(userId: string): Promise<DeckWithMeta[]>;
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
  /**
   * Refused (DeckColorError) when a mainboard card's identity is outside the
   * deck colors. Sideboard and maybeboard adds are not color-checked.
   */
  addCard(userId: string, deckId: string, card: CardInput): Promise<void>;
  /**
   * quantity 0 removes the card. Raising the quantity of a mainboard card
   * outside the deck colors is refused; lowering it never is. Sideboard and
   * maybeboard quantities are not color-checked.
   */
  setCardQuantity(userId: string, deckId: string, cardId: string, quantity: number): Promise<void>;
  /**
   * Owner only. Moves one row onto another board. The same printing already
   * on the destination is merged (quantity capped at 99) and that row's
   * category is kept. Otherwise category_id stays with the card, so moving
   * back to the mainboard restores its pile. Moving onto the mainboard is
   * color-checked.
   */
  moveCardToBoard(userId: string, deckId: string, cardId: string, board: DeckBoard): Promise<void>;
  /**
   * Owner only. `name` is already trimmed and within the category limits.
   * The new category is empty and sorts after the type groups until the
   * owner reorders. New cards are not assigned to it.
   */
  createCategory(userId: string, deckId: string, name: string): Promise<string>;
  /** Owner only. Case-insensitive unique name per deck, excluding itself. */
  renameCategory(userId: string, deckId: string, categoryId: string, name: string): Promise<void>;
  /**
   * Owner only. The category row goes away. Cards that were in it stay in
   * the deck with no assignment, so they show in their type group again.
   */
  deleteCategory(userId: string, deckId: string, categoryId: string): Promise<void>;
  /**
   * Owner only. `categoryId` null puts the card back in its type group.
   * A category from another deck is refused.
   */
  moveCardToCategory(
    userId: string,
    deckId: string,
    cardId: string,
    categoryId: string | null,
  ): Promise<void>;
  /**
   * Owner only. `sections` is every custom category id plus any `type:Creature`
   * (and the other derived type groups) in the order they should appear.
   * Omitting a category is refused. Type groups that are left out go back to
   * the default type order.
   */
  reorderSections(userId: string, deckId: string, sections: string[]): Promise<void>;
  /**
   * Throws a DataError unless userId owns a Commander-format deck deckId.
   * A cheap pre-check, so setCommanderAction refuses before it spends a
   * Scryfall lookup (Cipher L1); setCommander checks again when it writes.
   */
  assertCanSetCommander(userId: string, deckId: string): Promise<void>;
  /**
   * Owner only, Commander decks only. `commander` must already be built from
   * Scryfall data (commanderFromScryfall); null clears it. Both adapters
   * re-check the legendary-creature rule, and the database CHECKs it again.
   * Deck colors: the commander's identity must fit them; a deck with no
   * colors takes the commander's identity as its colors (refused if any card
   * falls outside it).
   */
  setCommander(userId: string, deckId: string, commander: DeckCommander | null): Promise<void>;
  /**
   * Copies cards, the commander and the deck colors. Visibility and
   * allow_forks follow the F4 rule either way. `name`, when given, is the
   * new deck's name (trimmed, 1–80 characters). Omitted, the deck is named
   * "<source> (branch)" — fork_deck() hardcodes that suffix, and the
   * Supabase adapter applies `name` with a follow-up owner UPDATE of the
   * name column only.
   *
   * That name is `decks.name`, the same column the header, the branch menu
   * and "Forked from" read. It is not stored per viewer. Anyone the deck's
   * visibility already allows sees it; anyone it doesn't, doesn't.
   */
  forkDeck(userId: string, deckId: string, name?: string): Promise<string>;
  /**
   * An independent deck: new id, `forkedFromId` null, its own branch tree.
   * `copiedFromId` records the source so the copy can be compared to it.
   * Same permission and F4 visibility defaults as forkDeck. `name`, when
   * given, is trimmed to 1–80 characters; omitted, the deck is named
   * "<source> (copy)".
   */
  copyDeck(userId: string, deckId: string, name?: string): Promise<string>;
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
  /**
   * Profile page for an exact, case-insensitive username. Anything that is
   * not a username is null. Null when this viewer cannot see that profile
   * (canViewProfile / public_profiles RLS). This is not find_profile(): that
   * RPC is security definer and would reveal profiles RLS hides.
   *
   * `profile.bio` is null for a logged-out viewer. `decks` is every deck this
   * owner has that this viewer may see (can_view_deck / RLS), including the
   * source-owner fork case. No extra visibility filter in the app.
   */
  getUserProfile(viewerId: string | null, username: string): Promise<UserProfileView | null>;
}
