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
 * Another user's profile as the UI sees it: exactly the columns of the
 * `public.public_profiles` view and of `find_profile()` in Supabase mode.
 * Deliberately has no `email` (only the signed-in user's own SessionUser
 * carries one), and no `bio`/`createdAt` (not needed to render a name).
 */
export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * A profile page (`/u/[username]`). `bio` is null unless this viewer is the
 * owner or an accepted friend (profile_bio). A string, possibly empty, when
 * they are. Still no email.
 */
export interface VisibleProfile extends PublicProfile {
  bio: string | null;
}

/** The signed-in user's own editable profile (profile page). */
export interface OwnProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
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
  /**
   * Scryfall color identity (W/U/B/R/G, WUBRG order), fetched by the server
   * when the card was added. null for cards added before deck colors.
   */
  colorIdentity?: string[] | null;
  oracleText: string | null;
  quantity: number;
  createdAt: string;
  /**
   * Set when the owner has moved this card into a deck category. Null or
   * missing: the card stays in the type group derived from its type line.
   */
  categoryId?: string | null;
}

/**
 * A category the deck owner created. Type groups (Creature, Instant, …) are
 * not rows: a card with no categoryId is shown in its derived type group.
 */
export interface DeckCategory {
  id: string;
  deckId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Where a derived type group sits after the owner has reordered the deck.
 * Missing for a type: the historical type order, until the owner arranges
 * the list (then new type groups follow the arranged ones).
 */
export interface DeckTypeOrder {
  deckId: string;
  /** Creature, Planeswalker, Instant, Sorcery, Artifact, Enchantment, Battle, Land, or Other. */
  typeKey: string;
  position: number;
}

/**
 * A Commander deck's commander: one legendary creature, kept on the deck row
 * itself (not in deck_cards), so it is never one of the 99 and never has a
 * quantity. Fields mirror how deck cards are stored; every value comes from
 * Scryfall on the server (setCommanderAction), never from the client.
 */
export interface DeckCommander {
  scryfallId: string;
  cardName: string;
  /** Front face type line; always contains "Legendary" and "Creature". */
  typeLine: string;
  manaCost: string | null;
  /** Full card image (Scryfall "normal"). */
  imageUri: string | null;
  /** Art crop for the commander banner (Scryfall "art_crop"). */
  artUri: string | null;
  /** W/U/B/R/G subset in WUBRG order; [] is colorless. */
  colorIdentity: string[];
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
  /**
   * Set on an independent copy: the deck it was copied from. Null on
   * originals and branches. Omitted on decks saved before copies existed.
   * Readers must not show this id unless the source deck is visible.
   */
  copiedFromId?: string | null;
  preferredBranchId: string | null;
  /** Only ever set when format is "commander" (DB CHECK decks_commander_format). */
  commander: DeckCommander | null;
  /**
   * The deck's color combination (W/U/B/R/G, WUBRG order; [] = Colorless).
   * Cards must fit inside it (src/lib/deck-colors.ts). null: no colors
   * picked yet (decks made before this feature), so nothing is restricted.
   */
  colors: string[] | null;
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
  /** Custom categories for this deck, in the owner's order. Empty when they have not made any. */
  categories?: DeckCategory[];
  /** Saved positions for type groups, after the owner reorders the list. */
  typeSectionOrders?: DeckTypeOrder[];
  cardCount?: number;
  forkCount?: number;
  sourceDeck?: (Deck & { owner?: PublicProfile }) | null;
  /**
   * The deck this copy was made from, when the viewer can see it. Undefined
   * or null hides the source: its id is not copied onto `copiedFromId`.
   */
  copiedFromDeck?: (Deck & { owner?: PublicProfile }) | null;
  /**
   * Unused. A hidden or missing source is omitted the same way as a deck
   * that was never a copy, so this is not a hint. The two owners still see
   * the other deck through `copyLinks`.
   */
  copySourceUnavailable?: boolean;
  /** Visible forks of this deck. `owner` is set when the branch author's profile loaded. */
  branches?: Array<Deck & { owner?: PublicProfile }>;
  /**
   * Visible forks of this deck's source, including this deck. Set on fork
   * pages (getDeck) so the branch menu can list siblings. Same visibility
   * cut as `branches`. Undefined on decks that are not forks.
   */
  sourceBranches?: Array<Deck & { owner?: PublicProfile }>;
  /**
   * Owner-only copy cross-links for the branch menu. Set on the deck page
   * for the source owner and the copy owner only. Name and handle, not cards.
   * `visible` is false when the other deck's normal visibility hides its cards.
   */
  copyLinks?: CopyLink[];
}

/** The other side of one copy, shown only to the two owners of that copy. */
export interface CopyLink {
  id: string;
  name: string;
  ownerId: string;
  username: string | null;
  role: "copy" | "original";
  visible: boolean;
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
