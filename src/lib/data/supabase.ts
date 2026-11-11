import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMANDER_MESSAGES, DataError, DeckColorError } from "@/lib/data/errors";
import {
  assertCardFits,
  assertColorsFitDeck,
  assertQuantityRaiseFits,
  colorsForCommander,
} from "@/lib/data/deck-color-rules";
import { normalizeDeckColors, storedCardIdentity } from "@/lib/deck-colors";
import { isMainBoard, mainboardQuantity, normalizeBoard } from "@/lib/deck-boards";
import { commanderProblem, normalizeColorIdentity, normalizeCommander } from "@/lib/commander";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit/messages";
import {
  FRIEND_MESSAGES,
  canRemove,
  canRespond,
  decideSendRequest,
  findPair,
} from "@/lib/data/friend-rules";
import type { FriendRow, Repository } from "@/lib/data/types";
import { USERNAME_RE, isUuid, scryfallImageOrNull } from "@/lib/data/validation";
import { LIMITS } from "@/lib/data/limits";
import {
  CATEGORY_MESSAGES,
  categoryNameKey,
  nextCategoryPosition,
  normalizeCategoryName,
  parseSectionOrder,
} from "@/lib/deck-categories";
import { requireForkName } from "@/lib/fork-name";
import { ORIGINAL_DECK_FORKS_LOCKED } from "@/lib/permissions";
import type {
  Comment,
  CopyLink,
  Deck,
  DeckCard,
  DeckCategory,
  DeckCommander,
  DeckTypeOrder,
  DeckFormat,
  DeckWithMeta,
  FavoriteCard,
  Friendship,
  FriendshipStatus,
  PublicProfile,
  Visibility,
} from "@/lib/types";

/**
 * Supabase backend. Follows the RLS model from supabase/migrations/002:
 *
 * - Every call uses the request-scoped server client (the user's own JWT
 *   from the auth cookies, or anon when signed out). Never a service role.
 *   RLS decides what is visible/writable; the explicit owner filters here only
 *   turn "0 rows affected" into a clear error message.
 * - Other people's names come from the `public_profiles` view (id, username,
 *   display_name, avatar_url), for signed-in and signed-out visitors alike.
 *   Nothing here reads an email; the caller's own email comes from the session.
 * - Forks go through rpc('fork_deck'); copies through rpc('copy_deck');
 *   friend lookup through rpc('find_profile') (exact username, 0 or 1 rows).
 *   A caller-chosen name is a second UPDATE of that new row's name column
 *   only (fork_deck still names it "<source> (branch)", copy_deck
 *   "<source> (copy)"). The decks SELECT policy returns that column with
 *   the rest of the row, so every viewer who can already see the deck
 *   reads the chosen name. Nothing here keeps a second, owner-only copy.
 * - copied_from_id is not selected. A source id arrives only from
 *   rpc('copy_source_link'), and only when that function says the source
 *   is visible. A hidden or missing source is the same as no source: no id.
 * - Deck inserts never send forked_from_id / preferred_branch_id:
 *   enforce_deck_links() rejects preferred_branch_id on API INSERTs, so a
 *   preferred branch is only ever set by a later UPDATE (setPreferredBranch).
 * - Ids from the client are checked to be UUIDs first and are only passed as
 *   bound filter values (.eq/.in), never interpolated into .or() strings.
 */

type Client = SupabaseClient;
export type ClientFactory = () => Promise<Client>;

type PgError = { code?: string; message?: string; hint?: string } | null;

// The commander_* columns come from migration 006, decks.colors /
// deck_cards.color_identity from 008, and deck_cards.board from 014: apply
// them before deploying this version (PostgREST rejects a select of unknown
// columns).
// (One string literal: supabase-js types the result from it.)
/** Every deck SELECT. Explicit columns only: never `*`, never copied_from_id. */
export const DECK_COLS =
  "id, owner_id, name, format, notes, visibility, allow_forks, forked_from_id, preferred_branch_id, commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost, commander_image_uri, commander_art_uri, commander_color_identity, colors, created_at, updated_at";
const CARD_COLS =
  "id, deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, color_identity, oracle_text, quantity, category_id, board, created_at";
const CATEGORY_COLS = "id, deck_id, name, position, created_at, updated_at";
const TYPE_ORDER_COLS = "deck_id, type_key, position";
/** What the deck-colors rules need from each card. */
const CARD_COLOR_COLS = "id, card_name, colors, color_identity, quantity, board";

/** Shown when a deck-colors CHECK or trigger (008) refuses a write the app let through (a race). */
const COLOR_CONFLICT = "That doesn't fit this deck's colors any more. Reload the deck and try again.";
const PROFILE_COLS = "id, username, display_name, avatar_url";
const FRIENDSHIP_COLS = "id, requester_id, addressee_id, status, created_at";
const FAVORITE_COLS = "id, user_id, scryfall_id, card_name, image_uri, mana_cost, type_line, created_at";

type DeckRow = {
  id: string;
  owner_id: string;
  name: string;
  format: string;
  notes: string;
  visibility: string;
  allow_forks: boolean;
  forked_from_id: string | null;
  preferred_branch_id: string | null;
  commander_scryfall_id?: string | null;
  commander_name?: string | null;
  commander_type_line?: string | null;
  commander_mana_cost?: string | null;
  commander_image_uri?: string | null;
  commander_art_uri?: string | null;
  commander_color_identity?: string[] | null;
  colors?: string[] | null;
  created_at: string;
  updated_at: string;
};
type CardRow = {
  id: string;
  deck_id: string;
  scryfall_id: string;
  card_name: string;
  image_uri: string | null;
  mana_cost: string | null;
  type_line: string;
  colors: string[] | null;
  color_identity?: string[] | null;
  oracle_text: string | null;
  quantity: number;
  category_id?: string | null;
  board?: string | null;
  created_at: string;
};
type CategoryRow = {
  id: string;
  deck_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
};
type TypeOrderRow = { deck_id: string; type_key: string; position: number };
type CardColorRow = Pick<
  CardRow,
  "id" | "card_name" | "colors" | "color_identity" | "quantity" | "board"
>;
type ProfileRow = { id: string; username: string; display_name: string; avatar_url: string | null };
type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
  created_at: string;
};
type FavoriteRow = {
  id: string;
  user_id: string;
  scryfall_id: string;
  card_name: string;
  image_uri: string | null;
  mana_cost: string | null;
  type_line: string | null;
  created_at: string;
};
type CommentRow = { id: string; deck_id: string; author_id: string; body: string; created_at: string };

export const toDeck = (r: DeckRow): Deck => ({
  id: r.id,
  ownerId: r.owner_id,
  name: r.name,
  format: r.format as DeckFormat,
  notes: r.notes ?? "",
  visibility: r.visibility as Visibility,
  allowForks: r.allow_forks,
  forkedFromId: r.forked_from_id,
  // Never read from the row. getDeck / getCompareData fill this from
  // copy_source_link() when the source is visible.
  copiedFromId: null,
  preferredBranchId: r.preferred_branch_id,
  commander: toCommander(r),
  // null (no colors picked) for decks made before 008.
  colors: Array.isArray(r.colors) ? normalizeDeckColors(r.colors) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** decks_commander_complete guarantees id, name and type line come together. */
function toCommander(r: DeckRow): DeckCommander | null {
  if (!r.commander_scryfall_id || !r.commander_name || !r.commander_type_line) return null;
  return {
    scryfallId: r.commander_scryfall_id,
    cardName: r.commander_name,
    typeLine: r.commander_type_line,
    manaCost: r.commander_mana_cost ?? null,
    imageUri: r.commander_image_uri ?? null,
    artUri: r.commander_art_uri ?? null,
    // Normalized on read too: a direct API write could have stored odd arrays
    // before migration 007 (Cipher I1).
    colorIdentity: normalizeColorIdentity(r.commander_color_identity),
  };
}

/** Column values for a commander (null clears every commander column). */
function commanderColumns(input: DeckCommander | null) {
  const c = input && normalizeCommander(input);
  return {
    commander_scryfall_id: c?.scryfallId ?? null,
    commander_name: c?.cardName ?? null,
    commander_type_line: c?.typeLine ?? null,
    commander_mana_cost: c?.manaCost ?? null,
    commander_image_uri: c?.imageUri ?? null,
    commander_art_uri: c?.artUri ?? null,
    commander_color_identity: c?.colorIdentity ?? [],
  };
}

const toCard = (r: CardRow): DeckCard => ({
  id: r.id,
  deckId: r.deck_id,
  scryfallId: r.scryfall_id,
  cardName: r.card_name,
  imageUri: r.image_uri,
  manaCost: r.mana_cost,
  typeLine: r.type_line,
  colors: r.colors ?? [],
  colorIdentity: Array.isArray(r.color_identity) ? normalizeDeckColors(r.color_identity) : null,
  oracleText: r.oracle_text,
  quantity: r.quantity,
  categoryId: r.category_id ?? null,
  board: normalizeBoard(r.board),
  createdAt: r.created_at,
});

const toCategory = (r: CategoryRow): DeckCategory => ({
  id: r.id,
  deckId: r.deck_id,
  name: r.name,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toTypeOrder = (r: TypeOrderRow): DeckTypeOrder => ({
  deckId: r.deck_id,
  typeKey: r.type_key,
  position: r.position,
});

export const toProfile = (r: ProfileRow): PublicProfile => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
});

const toFriendship = (r: FriendshipRow): Friendship => ({
  id: r.id,
  requesterId: r.requester_id,
  addresseeId: r.addressee_id,
  status: r.status as FriendshipStatus,
  createdAt: r.created_at,
});

const toFavorite = (r: FavoriteRow): FavoriteCard => ({
  id: r.id,
  userId: r.user_id,
  scryfallId: r.scryfall_id,
  cardName: r.card_name,
  imageUri: r.image_uri,
  manaCost: r.mana_cost,
  typeLine: r.type_line,
  createdAt: r.created_at,
});

const toComment = (r: CommentRow): Comment => ({
  id: r.id,
  deckId: r.deck_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
});

/** Unexpected database errors: logged server-side by the caller, never shown. */
class SupabaseDataError extends Error {
  constructor(
    readonly op: string,
    readonly code: string | undefined,
  ) {
    super(`supabase ${op} failed${code ? ` (${code})` : ""}`);
    this.name = "SupabaseDataError";
  }
}

function check<T>(op: string, res: { data: T; error: PgError }): T {
  if (res.error) throw new SupabaseDataError(op, res.error.code);
  return res.data;
}

/** The 008 CHECK constraints that are about deck colors. */
const COLOR_CONSTRAINTS = [
  "decks_colors_wubrg",
  "deck_cards_color_identity_wubrg",
  "decks_commander_fits_colors",
];
/** The hint 008's deck-colors triggers put on their errors. */
const COLOR_TRIGGER_HINT = "spellbranch_deck_colors";

/**
 * A 23514 from one of the 008 deck-colors rules, and nothing else: a
 * trigger error carrying 008's hint, or a violation of one of 008's
 * constraints, named exactly. (Older checks such as deck_cards_colors_valid
 * or decks_commander_colors_valid keep their own handling.)
 */
function isColorConflict(error: PgError): boolean {
  if (error?.code !== "23514") return false;
  if (error.hint === COLOR_TRIGGER_HINT) return true;
  const message = error.message ?? "";
  return COLOR_CONSTRAINTS.some((name) => message.includes(`"${name}"`));
}

/** check() for deck_cards writes, turning a deck-colors refusal into a readable error. */
function cardColorWrite<T>(op: string, res: { data: T; error: PgError }): T {
  if (isColorConflict(res.error)) throw new DeckColorError(COLOR_CONFLICT);
  return check(op, res);
}

/** Category writes: turn constraint failures into messages the UI can show. */
function categoryWrite<T>(op: string, res: { data: T; error: PgError }): T {
  const error = res.error;
  if (error) {
    const message = error.message ?? "";
    if (error.code === "23505" && message.includes("deck_categories_name_lower")) {
      throw new DataError(CATEGORY_MESSAGES.duplicate);
    }
    if (error.code === "23514" && message.includes("deck_categories_name_shape")) {
      throw new DataError(CATEGORY_MESSAGES.tooLong);
    }
    if (error.hint === "spellbranch_deck_category" && message.includes("40 categories")) {
      throw new DataError(CATEGORY_MESSAGES.cap);
    }
    if (
      error.hint === "spellbranch_deck_category" ||
      message.includes("deck_cards_category_same_deck")
    ) {
      throw new DataError(CATEGORY_MESSAGES.notFound);
    }
    if (error.code === "22023") throw new DataError(CATEGORY_MESSAGES.reload);
    if (error.code === "42501" || error.code === "P0002") throw new DataError(CATEGORY_MESSAGES.denied);
  }
  return check(op, res);
}

const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => Boolean(x)))];

const byUpdatedDesc = (a: Deck, b: Deck) => b.updatedAt.localeCompare(a.updatedAt);

async function loadProfiles(client: Client, ids: string[]): Promise<Map<string, PublicProfile>> {
  if (ids.length === 0) return new Map();
  const rows = check(
    "public_profiles",
    await client.from("public_profiles").select(PROFILE_COLS).in("id", ids),
  ) as ProfileRow[] | null;
  return new Map((rows ?? []).map((r) => [r.id, toProfile(r)]));
}

/**
 * Adds owner, card counts (and cards), branches and source, all under RLS.
 * `withSourceBranches` (deck pages) also loads visible forks of each deck's
 * source, for the branch menu. List views skip that query.
 */
async function decorate(
  client: Client,
  decks: Deck[],
  withCards: boolean,
  withSourceBranches = false,
): Promise<DeckWithMeta[]> {
  if (decks.length === 0) return [];
  const ids = decks.map((d) => d.id);
  const sourceIds = uniq(decks.map((d) => d.forkedFromId));

  const [cardsRes, categoriesRes, typeOrdersRes, branchesRes, sourcesRes, sourceBranchesRes, owners] =
    await Promise.all([
    client
      .from("deck_cards")
      .select(withCards ? CARD_COLS : "deck_id, quantity, board")
      .in("deck_id", ids),
    withCards
      ? client.from("deck_categories").select(CATEGORY_COLS).in("deck_id", ids)
      : Promise.resolve({ data: [], error: null }),
    withCards
      ? client.from("deck_type_orders").select(TYPE_ORDER_COLS).in("deck_id", ids)
      : Promise.resolve({ data: [], error: null }),
    client.from("decks").select(DECK_COLS).in("forked_from_id", ids),
    sourceIds.length
      ? client.from("decks").select(DECK_COLS).in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    withSourceBranches && sourceIds.length
      ? client.from("decks").select(DECK_COLS).in("forked_from_id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    loadProfiles(client, uniq(decks.map((d) => d.ownerId))),
  ]);

  const cardRows = (check("deck_cards", cardsRes) ?? []) as unknown as CardRow[];
  const categoryRows = withCards
    ? ((check("deck_categories", categoriesRes) ?? []) as CategoryRow[])
    : [];
  const typeOrderRows = withCards
    ? ((check("deck_type_orders", typeOrdersRes) ?? []) as TypeOrderRow[])
    : [];
  const branches = ((check("decks", branchesRes) ?? []) as DeckRow[]).map(toDeck);
  const sources = ((check("decks", sourcesRes) ?? []) as DeckRow[]).map(toDeck);
  const sourceBranchRows = withSourceBranches
    ? ((check("source branches", sourceBranchesRes) ?? []) as DeckRow[]).map(toDeck)
    : [];
  const branchOwners = await loadProfiles(
    client,
    uniq([
      ...branches.map((b) => b.ownerId),
      ...sourceBranchRows.map((b) => b.ownerId),
      ...sources.map((s) => s.ownerId),
    ]).filter((id) => !owners.has(id)),
  );
  const profile = (ownerId: string) => owners.get(ownerId) ?? branchOwners.get(ownerId);

  return decks.map((deck) => {
    const mine = cardRows.filter((c) => c.deck_id === deck.id);
    const deckBranches = branches.filter((b) => b.forkedFromId === deck.id);
    // RLS already hides branches the viewer can't see; a preferred branch
    // among them is reported as null so pages never link to it (review L1).
    const preferredBranchId =
      deck.preferredBranchId && deckBranches.some((b) => b.id === deck.preferredBranchId)
        ? deck.preferredBranchId
        : null;
    const sourceRow = deck.forkedFromId
      ? sources.find((s) => s.id === deck.forkedFromId)
      : undefined;
    return {
      ...deck,
      preferredBranchId,
      owner: owners.get(deck.ownerId),
      cards: withCards ? mine.map(toCard) : undefined,
      categories: withCards
        ? categoryRows
            .filter((c) => c.deck_id === deck.id)
            .map(toCategory)
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        : undefined,
      typeSectionOrders: withCards
        ? typeOrderRows.filter((t) => t.deck_id === deck.id).map(toTypeOrder)
        : undefined,
      cardCount: mainboardQuantity(mine),
      forkCount: deckBranches.length,
      sourceDeck: deck.forkedFromId
        ? sourceRow
          ? { ...sourceRow, owner: profile(sourceRow.ownerId) }
          : null
        : null,
      branches: deckBranches.map((b) => ({
        ...b,
        owner: profile(b.ownerId),
      })),
      sourceBranches: deck.forkedFromId
        ? sourceBranchRows
            .filter((b) => b.forkedFromId === deck.forkedFromId)
            .map((b) => ({ ...b, owner: profile(b.ownerId) }))
        : undefined,
    };
  });
}

type CopySourceRow = { source_id?: string | null; unavailable?: boolean };

/**
 * The source of a copy, under copy_source_link() (migration 010). A missing
 * function or a bad payload is an error: the app must not guess an id.
 */
type CopyLinkRow = {
  other_id?: string;
  other_name?: string;
  other_owner_id?: string;
  other_username?: string | null;
  link_role?: string;
  other_visible?: boolean;
};

/** Owner-only copy cross-links. Empty when the caller is not one of the two owners. */
async function copyLinksForDeck(client: Client, deckId: string): Promise<CopyLink[]> {
  const { data, error } = await client.rpc("copy_links_for_deck", { target: deckId });
  if (error) throw new SupabaseDataError("copy_links_for_deck", error.code);
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as CopyLinkRow[];
  const links: CopyLink[] = [];
  for (const row of rows) {
    if (typeof row.other_id !== "string" || typeof row.other_name !== "string") continue;
    if (row.link_role !== "copy" && row.link_role !== "original") continue;
    if (typeof row.other_owner_id !== "string") continue;
    links.push({
      id: row.other_id,
      name: row.other_name,
      ownerId: row.other_owner_id,
      username: typeof row.other_username === "string" ? row.other_username : null,
      role: row.link_role,
      visible: row.other_visible === true,
    });
  }
  return links;
}

async function copySourceLink(
  client: Client,
  deckId: string,
): Promise<{ sourceId: string | null; unavailable: boolean }> {
  const { data, error } = await client.rpc("copy_source_link", { target: deckId });
  if (error) throw new SupabaseDataError("copy_source_link", error.code);
  const row = (Array.isArray(data) ? data[0] : data) as CopySourceRow | null | undefined;
  const sourceId = row && typeof row.source_id === "string" ? row.source_id : null;
  // unavailable=true used to mean "a source exists but you cannot see it".
  // That hint is ignored. The two owners learn the link from copy_links_for_deck.
  return { sourceId, unavailable: false };
}

/**
 * Owner-only rename of a row this request just created. On failure the new
 * deck is deleted so a rejected name never leaves a deck behind. Visibility,
 * owner, and the fork/copy links stay whatever the RPC set.
 */
async function renameOwnedDeck(
  client: Client,
  userId: string,
  deckId: string,
  name: string,
  op: string,
  failure: string,
) {
  const { data: rows, error } = await client
    .from("decks")
    .update({ name })
    .eq("id", deckId)
    .eq("owner_id", userId)
    .select("id");
  if (error || !rows?.length) {
    await client.from("decks").delete().eq("id", deckId).eq("owner_id", userId);
    const message = error?.message ?? "";
    if (error?.code === "23514" && message.includes("decks_name_length")) {
      throw new DataError(`Deck name must be at most ${LIMITS.deckName} characters`);
    }
    if (error) throw new SupabaseDataError(op, error.code);
    throw new DataError(failure);
  }
}

async function fetchDeck(client: Client, deckId: string): Promise<Deck | null> {
  if (!isUuid(deckId)) return null;
  const row = check(
    "decks",
    await client.from("decks").select(DECK_COLS).eq("id", deckId).maybeSingle(),
  ) as DeckRow | null;
  return row ? toDeck(row) : null;
}

async function requireOwnDeck(client: Client, userId: string, deckId: string, message: string) {
  const deck = await fetchDeck(client, deckId);
  if (!deck || deck.ownerId !== userId) throw new DataError(message);
  return deck;
}

/** The deck's cards, as the deck-colors rules need them. */
async function cardsForColorCheck(client: Client, deckId: string) {
  const rows = check(
    "deck_cards colors",
    await client.from("deck_cards").select(CARD_COLOR_COLS).eq("deck_id", deckId),
  ) as CardColorRow[] | null;
  return (rows ?? []).map((r) => ({
    id: r.id,
    cardName: r.card_name,
    colors: r.colors ?? [],
    colorIdentity: r.color_identity ?? null,
    quantity: r.quantity,
    board: r.board,
  }));
}

async function touchDeck(client: Client, deckId: string) {
  // decks_set_updated_at sets the real timestamp.
  check(
    "decks touch",
    await client.from("decks").update({ updated_at: new Date().toISOString() }).eq("id", deckId),
  );
}

async function fetchFriendship(client: Client, id: string): Promise<Friendship | null> {
  if (!isUuid(id)) return null;
  const row = check(
    "friendships",
    await client.from("friendships").select(FRIENDSHIP_COLS).eq("id", id).maybeSingle(),
  ) as FriendshipRow | null;
  return row ? toFriendship(row) : null;
}

async function fetchPair(client: Client, a: string, b: string): Promise<Friendship | undefined> {
  // Both ids bound as values: rows whose requester and addressee are both in
  // {a, b}. (a, b) and (b, a) are the only possibilities: no self-friending.
  const rows = check(
    "friendships pair",
    await client
      .from("friendships")
      .select(FRIENDSHIP_COLS)
      .in("requester_id", [a, b])
      .in("addressee_id", [a, b]),
  ) as FriendshipRow[] | null;
  return findPair((rows ?? []).map(toFriendship), a, b);
}

export function createSupabaseRepository(getClient: ClientFactory): Repository {
  return {
    async listDecks(viewerId, scope) {
      if (scope !== "public" && !viewerId) return [];
      const client = await getClient();
      let query = client.from("decks").select(DECK_COLS);
      if (scope === "mine") {
        query = query.eq("owner_id", viewerId!).is("forked_from_id", null);
      } else if (scope === "friends") {
        // RLS only returns friends-only decks of accepted friends.
        query = query.eq("visibility", "friends").neq("owner_id", viewerId!);
      } else {
        query = query.eq("visibility", "public").is("forked_from_id", null);
      }
      const rows = check("decks list", await query.order("updated_at", { ascending: false })) as
        | DeckRow[]
        | null;
      const decks = await decorate(client, (rows ?? []).map(toDeck), false);
      return decks.sort(byUpdatedDesc);
    },

    async listMyBranches(userId) {
      const client = await getClient();
      const rows = check(
        "decks branches",
        await client
          .from("decks")
          .select(DECK_COLS)
          .eq("owner_id", userId)
          .not("forked_from_id", "is", null)
          .order("updated_at", { ascending: false }),
      ) as DeckRow[] | null;
      const decks = await decorate(client, (rows ?? []).map(toDeck), false);
      return decks.sort(byUpdatedDesc);
    },

    async listFriendBranchesOnMyDecks(userId) {
      const client = await getClient();
      const [sourcesRes, friendsRes] = await Promise.all([
        client.from("decks").select("id").eq("owner_id", userId),
        client
          .from("friendships")
          .select("requester_id, addressee_id")
          .eq("status", "accepted"),
      ]);
      const sourceIds = ((check("decks owned", sourcesRes) ?? []) as { id: string }[]).map(
        (row) => row.id,
      );
      const friendIds = new Set<string>();
      for (const row of (check("friendships", friendsRes) ?? []) as {
        requester_id: string;
        addressee_id: string;
      }[]) {
        if (row.requester_id === userId) friendIds.add(row.addressee_id);
        else if (row.addressee_id === userId) friendIds.add(row.requester_id);
      }
      if (sourceIds.length === 0 || friendIds.size === 0) return [];
      const rows = check(
        "friend branches",
        await client
          .from("decks")
          .select(DECK_COLS)
          .in("forked_from_id", sourceIds)
          .in("owner_id", [...friendIds])
          .order("updated_at", { ascending: false }),
      ) as DeckRow[] | null;
      const decks = await decorate(client, (rows ?? []).map(toDeck), false);
      return decks.sort(byUpdatedDesc);
    },

    async getDeck(viewerId, deckId) {
      const client = await getClient();
      const deck = await fetchDeck(client, deckId);
      if (!deck) return null;
      const [decorated] = await decorate(client, [deck], true, true);
      if (viewerId) {
        const copyLinks = await copyLinksForDeck(client, deck.id);
        if (copyLinks.length > 0) decorated.copyLinks = copyLinks;
      }
      const link = await copySourceLink(client, deck.id);
      if (link.sourceId) {
        const src = await fetchDeck(client, link.sourceId);
        if (src) {
          const owners = await loadProfiles(client, [src.ownerId]);
          decorated.copiedFromId = src.id;
          decorated.copiedFromDeck = { ...src, owner: owners.get(src.ownerId) };
          decorated.copySourceUnavailable = false;
        } else {
          // The function said the source was visible, then it wasn't. Drop the id.
          // Same shape as a deck that is not a copy.
          decorated.copiedFromId = null;
          decorated.copySourceUnavailable = false;
        }
      } else {
        decorated.copiedFromId = null;
        decorated.copySourceUnavailable = false;
      }
      return decorated;
    },

    async getCompareData(viewerId, sourceId, branchId) {
      const client = await getClient();
      const [source, branch] = await Promise.all([
        fetchDeck(client, sourceId),
        fetchDeck(client, branchId),
      ]);
      if (!source || !branch) return null;
      const link = await copySourceLink(client, branch.id);
      const isFork = branch.forkedFromId === source.id;
      // A copy compares against the deck it was copied from, which is not
      // its parent. The id comes from copy_source_link(), so a hidden source
      // never matches.
      const isCopy = !branch.forkedFromId && link.sourceId === source.id;
      if (!isFork && !isCopy) return null;
      const [s, b] = await decorate(client, [source, branch], true);
      if (isCopy) {
        b.copiedFromId = source.id;
        b.copiedFromDeck = { ...s, owner: s.owner };
        b.copySourceUnavailable = false;
      }
      return {
        source: s,
        branch: b,
        canSetPreferred: isFork && Boolean(viewerId) && source.ownerId === viewerId,
        copy: isCopy,
      };
    },

    async getDeckPermissions(viewerId, deckId) {
      const none = { canEdit: false, canFork: false, canCopy: false, canComment: false };
      const client = await getClient();
      const deck = await fetchDeck(client, deckId); // visible under RLS, or null
      if (!deck || !viewerId) return none;
      const isOwner = deck.ownerId === viewerId;
      // Copy follows this deck only. Fork of a branch also needs the original
      // deck to be visible and still forkable (or owned by the caller).
      const canCopy = isOwner || deck.allowForks;
      let canFork = canCopy;
      if (canFork && deck.forkedFromId) {
        const root = await fetchDeck(client, deck.forkedFromId);
        canFork = Boolean(root) && (root!.ownerId === viewerId || root!.allowForks);
      }
      return { canEdit: isOwner, canFork, canCopy, canComment: true };
    },

    async createDeck(userId, input) {
      const client = await getClient();
      const row = check(
        "decks insert",
        await client
          .from("decks")
          .insert({
            owner_id: userId,
            name: input.name,
            format: input.format,
            notes: input.notes,
            visibility: input.visibility,
            allow_forks: input.allowForks,
            colors: input.colors ? normalizeDeckColors(input.colors) : null,
          })
          .select("id")
          .single(),
      ) as { id: string };
      return row.id;
    },

    async updateDeck(userId, deckId, input) {
      const denied = "You cannot edit this deck";
      if (!isUuid(deckId)) throw new DataError(denied);
      const client = await getClient();
      // No colors in the input: leave them as they are.
      const colors = input.colors ? normalizeDeckColors(input.colors) : undefined;
      if (colors) {
        const deck = await requireOwnDeck(client, userId, deckId, denied);
        const keepsCommander = input.format === "commander" ? deck.commander : null;
        assertColorsFitDeck(colors, await cardsForColorCheck(client, deckId), keepsCommander);
      }
      const { data: rows, error } = await client
        .from("decks")
        .update({
          name: input.name,
          format: input.format,
          notes: input.notes,
          visibility: input.visibility,
          allow_forks: input.allowForks,
          ...(colors ? { colors } : {}),
          // Leaving Commander clears the commander in the same UPDATE, so
          // decks_commander_format (commander => format = 'commander')
          // never rejects a format change.
          ...(input.format === "commander" ? {} : commanderColumns(null)),
        })
        .eq("id", deckId)
        .eq("owner_id", userId)
        .select("id");
      if (error) {
        // 23514: a card or the commander was added in between and no longer fits (008).
        if (colors && isColorConflict(error)) throw new DeckColorError(COLOR_CONFLICT);
        throw new SupabaseDataError("decks update", error.code);
      }
      if (!rows?.length) throw new DataError(denied);
    },

    async assertCanSetCommander(userId, deckId) {
      const denied = "You cannot edit this deck";
      if (!isUuid(deckId)) throw new DataError(denied);
      const deck = await requireOwnDeck(await getClient(), userId, deckId, denied);
      if (deck.format !== "commander") throw new DataError(COMMANDER_MESSAGES.notCommanderFormat);
    },

    async setCommander(userId, deckId, commander) {
      const denied = "You cannot edit this deck";
      if (!isUuid(deckId)) throw new DataError(denied);
      const client = await getClient();
      const deck = await requireOwnDeck(client, userId, deckId, denied);
      if (commander && deck.format !== "commander") {
        throw new DataError(COMMANDER_MESSAGES.notCommanderFormat);
      }
      const problem = commander && commanderProblem(commander);
      if (problem) throw new DataError(COMMANDER_MESSAGES[problem]);

      let deckColors = deck.colors;
      // At most two tries: the second only when colors were picked (in
      // another tab) between our read and our write.
      for (let attempt = 1; ; attempt++) {
        // A deck without colors takes the commander's identity, but only
        // while it still has none (.is("colors", null)), so a colors pick
        // made meanwhile is never overwritten.
        const adoptColors = Boolean(commander) && deckColors === null;
        // The commander must fit the deck colors (throws a clear error).
        const colors = commander
          ? colorsForCommander(
              normalizeCommander(commander),
              deckColors,
              adoptColors ? await cardsForColorCheck(client, deckId) : [],
            )
          : null;
        let query = client
          .from("decks")
          .update({
            ...commanderColumns(commander),
            ...(adoptColors ? { colors } : {}),
          })
          .eq("id", deckId)
          .eq("owner_id", userId);
        // Guards a format change racing this write; the CHECK is the backstop.
        if (commander) query = query.eq("format", "commander");
        if (adoptColors) query = query.is("colors", null);
        const { data, error } = await query.select("id");
        if (error) {
          // 23514: one of the decks_commander_* CHECKs (format or type line),
          // or (008) the colors changed in between so the commander no longer fits.
          if (isColorConflict(error)) throw new DeckColorError(COLOR_CONFLICT);
          if (error.code === "23514") throw new DataError(COMMANDER_MESSAGES.notLegendaryCreature);
          throw new SupabaseDataError("decks commander", error.code);
        }
        if (data?.length) return;

        if (adoptColors && attempt === 1) {
          // Nothing updated: maybe the colors were picked meanwhile. Re-read
          // and check the commander against them instead.
          const fresh = await requireOwnDeck(client, userId, deckId, denied);
          if (fresh.colors !== null) {
            deckColors = fresh.colors;
            continue;
          }
        }
        throw new DataError(commander ? COMMANDER_MESSAGES.notCommanderFormat : denied);
      }
    },

    async deleteDeck(userId, deckId) {
      if (!isUuid(deckId)) throw new DataError("You cannot delete this deck");
      const client = await getClient();
      // Cards and comments cascade. Forks keep their cards and get
      // forked_from_id = null; copies get copied_from_id = null
      // (both ON DELETE SET NULL), like local mode.
      const rows = check(
        "decks delete",
        await client.from("decks").delete().eq("id", deckId).eq("owner_id", userId).select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError("You cannot delete this deck");
    },

    async addCard(userId, deckId, card) {
      const client = await getClient();
      const deck = await requireOwnDeck(client, userId, deckId, "You cannot edit this deck");
      const colorIdentity = normalizeDeckColors(card.colorIdentity);
      const board = normalizeBoard(card.board);
      if (board === "main") assertCardFits(card.cardName, colorIdentity, deck.colors);
      const existing = check(
        "deck_cards find",
        await client
          .from("deck_cards")
          .select("id, quantity")
          .eq("deck_id", deckId)
          .eq("scryfall_id", card.scryfallId)
          .eq("board", board)
          .maybeSingle(),
      ) as { id: string; quantity: number } | null;

      if (existing) {
        cardColorWrite(
          "deck_cards update",
          await client
            .from("deck_cards")
            .update({
              quantity: Math.min(99, existing.quantity + card.quantity),
              color_identity: colorIdentity,
            })
            .eq("id", existing.id)
            .eq("board", board),
        );
      } else {
        cardColorWrite(
          "deck_cards insert",
          await client.from("deck_cards").insert({
            deck_id: deckId,
            scryfall_id: card.scryfallId,
            card_name: card.cardName,
            image_uri: scryfallImageOrNull(card.imageUri),
            mana_cost: card.manaCost,
            type_line: card.typeLine,
            colors: card.colors,
            color_identity: colorIdentity,
            oracle_text: card.oracleText,
            quantity: card.quantity,
            board,
          }),
        );
      }
      await touchDeck(client, deckId);
    },

    async setCardQuantity(userId, deckId, cardId, quantity) {
      const client = await getClient();
      const deck = await requireOwnDeck(client, userId, deckId, "You cannot edit this deck");
      if (!isUuid(cardId)) throw new DataError("Card not found in deck");
      if (quantity === 0) {
        check(
          "deck_cards delete",
          await client.from("deck_cards").delete().eq("id", cardId).eq("deck_id", deckId),
        );
      } else {
        if (deck.colors !== null) {
          const current = check(
            "deck_cards find",
            await client
              .from("deck_cards")
              .select(CARD_COLOR_COLS)
              .eq("id", cardId)
              .eq("deck_id", deckId)
              .maybeSingle(),
          ) as CardColorRow | null;
          if (!current) throw new DataError("Card not found in deck");
          if (quantity > current.quantity && isMainBoard(current.board)) {
            assertQuantityRaiseFits(
              { cardName: current.card_name, colors: current.colors ?? [], colorIdentity: current.color_identity },
              deck.colors,
            );
          }
        }
        const rows = cardColorWrite(
          "deck_cards quantity",
          await client
            .from("deck_cards")
            .update({ quantity })
            .eq("id", cardId)
            .eq("deck_id", deckId)
            .select("id"),
        ) as { id: string }[] | null;
        if (!rows?.length) throw new DataError("Card not found in deck");
      }
      await touchDeck(client, deckId);
    },

    async createCategory(userId, deckId, name) {
      const parsed = normalizeCategoryName(name);
      if (!parsed.ok) throw new DataError(parsed.error);
      const client = await getClient();
      await requireOwnDeck(client, userId, deckId, CATEGORY_MESSAGES.denied);
      const existing = categoryWrite(
        "deck_categories",
        await client.from("deck_categories").select("id, name, position").eq("deck_id", deckId),
      ) as { id: string; name: string; position: number }[] | null;
      const mine = existing ?? [];
      if (mine.length >= LIMITS.deckCategories) throw new DataError(CATEGORY_MESSAGES.cap);
      const key = categoryNameKey(parsed.name);
      if (mine.some((c) => categoryNameKey(c.name) === key)) {
        throw new DataError(CATEGORY_MESSAGES.duplicate);
      }
      const row = categoryWrite(
        "deck_categories insert",
        await client
          .from("deck_categories")
          .insert({
            deck_id: deckId,
            name: parsed.name,
            position: nextCategoryPosition(mine),
          })
          .select("id")
          .single(),
      ) as { id: string };
      await touchDeck(client, deckId);
      return row.id;
    },

    async renameCategory(userId, deckId, categoryId, name) {
      const parsed = normalizeCategoryName(name);
      if (!parsed.ok) throw new DataError(parsed.error);
      if (!isUuid(categoryId)) throw new DataError(CATEGORY_MESSAGES.notFound);
      const client = await getClient();
      await requireOwnDeck(client, userId, deckId, CATEGORY_MESSAGES.denied);
      const existing = categoryWrite(
        "deck_categories",
        await client.from("deck_categories").select("id, name").eq("deck_id", deckId),
      ) as { id: string; name: string }[] | null;
      const mine = existing ?? [];
      if (!mine.some((c) => c.id === categoryId)) throw new DataError(CATEGORY_MESSAGES.notFound);
      const key = categoryNameKey(parsed.name);
      if (mine.some((c) => c.id !== categoryId && categoryNameKey(c.name) === key)) {
        throw new DataError(CATEGORY_MESSAGES.duplicate);
      }
      const rows = categoryWrite(
        "deck_categories rename",
        await client
          .from("deck_categories")
          .update({ name: parsed.name })
          .eq("id", categoryId)
          .eq("deck_id", deckId)
          .select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError(CATEGORY_MESSAGES.notFound);
      await touchDeck(client, deckId);
    },

    async deleteCategory(userId, deckId, categoryId) {
      if (!isUuid(categoryId)) throw new DataError(CATEGORY_MESSAGES.notFound);
      const client = await getClient();
      await requireOwnDeck(client, userId, deckId, CATEGORY_MESSAGES.denied);
      // ON DELETE SET NULL clears the cards' category_id. The cards stay.
      const rows = categoryWrite(
        "deck_categories delete",
        await client
          .from("deck_categories")
          .delete()
          .eq("id", categoryId)
          .eq("deck_id", deckId)
          .select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError(CATEGORY_MESSAGES.notFound);
      await touchDeck(client, deckId);
    },

    async moveCardToBoard(userId, deckId, cardId, board) {
      const target = normalizeBoard(board);
      if (!isUuid(cardId)) throw new DataError("Card not found in deck");
      const client = await getClient();
      const deck = await requireOwnDeck(client, userId, deckId, "You cannot edit this deck");
      const current = check(
        "deck_cards find",
        await client
          .from("deck_cards")
          .select("id, scryfall_id, card_name, quantity, colors, color_identity, board")
          .eq("id", cardId)
          .eq("deck_id", deckId)
          .maybeSingle(),
      ) as {
        id: string;
        scryfall_id: string;
        card_name: string;
        quantity: number;
        colors: string[] | null;
        color_identity: string[] | null;
        board: string | null;
      } | null;
      if (!current) throw new DataError("Card not found in deck");
      if (normalizeBoard(current.board) === target) return;
      if (target === "main") {
        assertCardFits(
          current.card_name,
          storedCardIdentity({ colorIdentity: current.color_identity, colors: current.colors }),
          deck.colors,
        );
      }
      const other = check(
        "deck_cards find board",
        await client
          .from("deck_cards")
          .select("id, quantity")
          .eq("deck_id", deckId)
          .eq("scryfall_id", current.scryfall_id)
          .eq("board", target)
          .maybeSingle(),
      ) as { id: string; quantity: number } | null;

      if (other && other.id !== current.id) {
        cardColorWrite(
          "deck_cards merge",
          await client
            .from("deck_cards")
            .update({ quantity: Math.min(99, other.quantity + current.quantity) })
            .eq("id", other.id)
            .eq("deck_id", deckId),
        );
        check(
          "deck_cards move delete",
          await client.from("deck_cards").delete().eq("id", cardId).eq("deck_id", deckId),
        );
      } else {
        const res = await client
          .from("deck_cards")
          .update({ board: target })
          .eq("id", cardId)
          .eq("deck_id", deckId)
          .select("id");
        if (res.error?.code === "23505") {
          throw new DataError("That card is already on that board. Reload the deck and try again.");
        }
        const rows = cardColorWrite("deck_cards board", res) as { id: string }[] | null;
        if (!rows?.length) throw new DataError("Card not found in deck");
      }
      await touchDeck(client, deckId);
    },

    async moveCardToCategory(userId, deckId, cardId, categoryId) {
      if (!isUuid(cardId)) throw new DataError(CATEGORY_MESSAGES.cardMissing);
      if (categoryId !== null && !isUuid(categoryId)) throw new DataError(CATEGORY_MESSAGES.notFound);
      const client = await getClient();
      await requireOwnDeck(client, userId, deckId, CATEGORY_MESSAGES.denied);
      if (categoryId !== null) {
        const category = categoryWrite(
          "deck_categories find",
          await client
            .from("deck_categories")
            .select("id")
            .eq("id", categoryId)
            .eq("deck_id", deckId)
            .maybeSingle(),
        ) as { id: string } | null;
        if (!category) throw new DataError(CATEGORY_MESSAGES.notFound);
      }
      const rows = categoryWrite(
        "deck_cards category",
        await client
          .from("deck_cards")
          .update({ category_id: categoryId })
          .eq("id", cardId)
          .eq("deck_id", deckId)
          .select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError(CATEGORY_MESSAGES.cardMissing);
      await touchDeck(client, deckId);
    },

    async reorderSections(userId, deckId, sections) {
      const client = await getClient();
      const deck = await requireOwnDeck(client, userId, deckId, CATEGORY_MESSAGES.denied);
      const existing = categoryWrite(
        "deck_categories",
        await client.from("deck_categories").select("id").eq("deck_id", deck.id),
      ) as { id: string }[] | null;
      const parsed = parseSectionOrder((existing ?? []).map((c) => c.id), sections);
      if (!parsed.ok) throw new DataError(parsed.error);
      categoryWrite(
        "set_deck_section_order",
        await client.rpc("set_deck_section_order", {
          deck: deckId,
          sections: parsed.items.map((item) => (item.kind === "category" ? item.id : `type:${item.typeKey}`)),
        }),
      );
      await touchDeck(client, deckId);
    },

    async forkDeck(_userId, deckId, name) {
      const denied = "You are not allowed to fork this deck";
      if (!isUuid(deckId)) throw new DataError(denied);
      // Before the RPC, so a rejected name never inserts a deck. fork_deck()
      // still writes "<source> (branch)"; the name is applied below.
      const forkName = name === undefined ? undefined : requireForkName(name);
      const client = await getClient();
      const { data, error } = await client.rpc("fork_deck", { source: deckId });
      if (error) {
        if (error.code === "PT429") throw new DataError(RATE_LIMITED_MESSAGE);
        // The trigger names this case when the caller can see the original
        // deck and that deck has forks turned off. A hidden root stays the
        // generic refusal, so the message does not reveal it.
        if (error.hint === "spellbranch_root_forks_locked") {
          throw new DataError(ORIGINAL_DECK_FORKS_LOCKED);
        }
        // 42501: not allowed (or invisible); P0002: not found. Same message.
        if (error.code === "42501" || error.code === "P0002") throw new DataError(denied);
        throw new SupabaseDataError("fork_deck", error.code);
      }
      if (typeof data !== "string") throw new SupabaseDataError("fork_deck", "bad-result");
      if (forkName === undefined) return data;

      // Owner-only rename. Visibility, allow_forks, owner and forked_from_id
      // stay whatever fork_deck() set (review F4). The trigger already
      // pointed forked_from_id at the root.
      await renameOwnedDeck(client, _userId, data, forkName, "fork rename", "Fork failed");
      return data;
    },

    async copyDeck(_userId, deckId, name) {
      const denied = "You are not allowed to copy this deck";
      if (!isUuid(deckId)) throw new DataError(denied);
      const copyName = name === undefined ? undefined : requireForkName(name);
      const client = await getClient();
      const { data, error } = await client.rpc("copy_deck", { source: deckId });
      if (error) {
        if (error.code === "PT429") throw new DataError(RATE_LIMITED_MESSAGE);
        if (error.code === "42501" || error.code === "P0002") throw new DataError(denied);
        throw new SupabaseDataError("copy_deck", error.code);
      }
      if (typeof data !== "string") throw new SupabaseDataError("copy_deck", "bad-result");
      if (copyName === undefined) return data;
      await renameOwnedDeck(client, _userId, data, copyName, "copy rename", "Copy failed");
      return data;
    },

    async setPreferredBranch(userId, sourceId, branchId) {
      const ownerOnly = "Only the source deck owner can set a preferred branch";
      const notBranch = "Branch does not belong to this deck";
      const client = await getClient();
      await requireOwnDeck(client, userId, sourceId, ownerOnly);
      if (branchId !== null && !isUuid(branchId)) throw new DataError(notBranch);
      // enforce_deck_links() checks the branch is a visible fork of the source.
      const { data, error } = await client
        .from("decks")
        .update({ preferred_branch_id: branchId })
        .eq("id", sourceId)
        .eq("owner_id", userId)
        .select("id");
      if (error) {
        if (error.code === "23514") throw new DataError(notBranch);
        throw new SupabaseDataError("decks preferred", error.code);
      }
      if (!data?.length) throw new DataError(ownerOnly);
    },

    async listComments(_viewerId, deckId) {
      if (!isUuid(deckId)) return [];
      const client = await getClient();
      const rows = check(
        "comments",
        await client
          .from("comments")
          .select("id, deck_id, author_id, body, created_at")
          .eq("deck_id", deckId)
          .order("created_at", { ascending: true }),
      ) as CommentRow[] | null;
      const comments = (rows ?? []).map(toComment);
      const authors = await loadProfiles(client, uniq(comments.map((c) => c.authorId)));
      return comments.map((c) => {
        const a = authors.get(c.authorId);
        return { ...c, author: a ? { id: a.id, username: a.username, displayName: a.displayName } : null };
      });
    },

    async addComment(userId, deckId, body) {
      const denied = "You cannot comment on this deck";
      if (!isUuid(deckId)) throw new DataError(denied);
      const client = await getClient();
      const { error } = await client
        .from("comments")
        .insert({ deck_id: deckId, author_id: userId, body });
      if (error) {
        // RLS (can't see the deck) or a deck that no longer exists.
        if (error.code === "42501" || error.code === "23503") throw new DataError(denied);
        throw new SupabaseDataError("comments insert", error.code);
      }
    },

    async listFavorites(userId) {
      const client = await getClient();
      const rows = check(
        "favorite_cards",
        await client
          .from("favorite_cards")
          .select(FAVORITE_COLS)
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
      ) as FavoriteRow[] | null;
      return (rows ?? []).map(toFavorite);
    },

    async addFavorite(userId, input) {
      const client = await getClient();
      const { error } = await client.from("favorite_cards").insert({
        user_id: userId,
        scryfall_id: input.scryfallId,
        card_name: input.cardName,
        image_uri: scryfallImageOrNull(input.imageUri),
        mana_cost: input.manaCost,
        type_line: input.typeLine,
      });
      // Already a favorite (unique user_id, scryfall_id): same as local mode.
      if (error && error.code !== "23505") throw new SupabaseDataError("favorite insert", error.code);
    },

    async removeFavorite(userId, favoriteId) {
      if (!isUuid(favoriteId)) return;
      const client = await getClient();
      check(
        "favorite delete",
        await client.from("favorite_cards").delete().eq("id", favoriteId).eq("user_id", userId),
      );
    },

    async getFriendsData(userId) {
      const client = await getClient();
      // RLS: only rows where the caller is requester or addressee.
      const rows = check(
        "friendships",
        await client.from("friendships").select(FRIENDSHIP_COLS).order("created_at"),
      ) as FriendshipRow[] | null;
      const mine = (rows ?? [])
        .map(toFriendship)
        .filter((f) => f.requesterId === userId || f.addresseeId === userId);
      const other = (f: Friendship) => (f.requesterId === userId ? f.addresseeId : f.requesterId);
      const profiles = await loadProfiles(client, uniq(mine.map(other)));

      const rowsWhere = (pred: (f: Friendship) => boolean): FriendRow[] =>
        mine.filter(pred).flatMap((f) => {
          const profile = profiles.get(other(f));
          return profile ? [{ friendship: f, profile }] : [];
        });

      return {
        friends: rowsWhere((f) => f.status === "accepted"),
        incoming: rowsWhere((f) => f.status === "pending" && f.addresseeId === userId),
        outgoing: rowsWhere((f) => f.status === "pending" && f.requesterId === userId),
      };
    },

    async findProfile(userId, username) {
      const q = username.trim();
      if (!USERNAME_RE.test(q)) return [];
      const client = await getClient();
      const res = await client.rpc("find_profile", { username: q });
      // Migration 004: the per-user database backstop raises PT429.
      if (res.error?.code === "PT429") throw new DataError(RATE_LIMITED_MESSAGE);
      const rows = check("find_profile", res) as ProfileRow[] | null;
      return (rows ?? [])
        .slice(0, 1)
        .map(toProfile)
        .filter((p) => p.id !== userId);
    },

    async sendFriendRequest(userId, addresseeId) {
      if (userId === addresseeId) throw new DataError(FRIEND_MESSAGES.self);
      if (!isUuid(addresseeId)) throw new DataError(FRIEND_MESSAGES.notFound);
      const client = await getClient();

      const decision = decideSendRequest(
        await fetchPair(client, userId, addresseeId),
        userId,
        addresseeId,
      );
      if (decision.kind === "error") throw new DataError(decision.message);
      if (decision.kind === "replace") {
        // The caller is the addressee of a declined row and asks the other
        // way round. restart_friend_request() (003) deletes the declined row
        // and inserts the new pending one in ONE transaction (review I1), so
        // nobody can slip a request into a gap between two HTTP calls.
        const { error } = await client.rpc("restart_friend_request", { other: addresseeId });
        if (!error) return;
        // P0002: the declined row is already gone; fall through to a plain
        // insert. 23505: a row for the pair appeared meanwhile (handled below).
        if (error.code !== "P0002" && error.code !== "23505") {
          throw new SupabaseDataError("restart_friend_request", error.code);
        }
        if (error.code === "23505") {
          const again = decideSendRequest(
            await fetchPair(client, userId, addresseeId),
            userId,
            addresseeId,
          );
          throw new DataError(again.kind === "error" ? again.message : FRIEND_MESSAGES.alreadySent);
        }
      }

      const { error } = await client
        .from("friendships")
        .insert({ requester_id: userId, addressee_id: addresseeId, status: "pending" });
      if (!error) return;
      if (error.code === "23503") throw new DataError(FRIEND_MESSAGES.notFound);
      if (error.code === "23505") {
        // A row for this pair appeared meanwhile (or is the declined one the
        // database refuses to reuse): explain it from the caller's view.
        const again = decideSendRequest(
          await fetchPair(client, userId, addresseeId),
          userId,
          addresseeId,
        );
        throw new DataError(again.kind === "error" ? again.message : FRIEND_MESSAGES.alreadySent);
      }
      throw new SupabaseDataError("friendships insert", error.code);
    },

    async respondFriendRequest(userId, friendshipId, accept) {
      const client = await getClient();
      const f = await fetchFriendship(client, friendshipId);
      if (!f || !canRespond(f, userId)) throw new DataError(FRIEND_MESSAGES.requestNotFound);
      const rows = check(
        "friendships respond",
        await client
          .from("friendships")
          .update({ status: accept ? "accepted" : "declined" })
          .eq("id", f.id)
          .eq("addressee_id", userId)
          .eq("status", "pending")
          .select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError(FRIEND_MESSAGES.requestNotFound);
    },

    async removeFriendship(userId, friendshipId) {
      const client = await getClient();
      const f = await fetchFriendship(client, friendshipId);
      if (!f) throw new DataError(FRIEND_MESSAGES.requestNotFound);
      if (!canRemove(f, userId)) throw new DataError(FRIEND_MESSAGES.cannotRemove);
      const rows = check(
        "friendships delete",
        await client.from("friendships").delete().eq("id", f.id).select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError(FRIEND_MESSAGES.cannotRemove);
    },

    async getOwnProfile(userId) {
      const client = await getClient();
      // bio is not selectable (012). profile_bio() returns it for the owner.
      const row = check(
        "profiles own",
        await client
          .from("profiles")
          .select("id, username, display_name")
          .eq("id", userId)
          .maybeSingle(),
      ) as { id: string; username: string; display_name: string } | null;
      if (!row) return null;
      const bioRes = await client.rpc("profile_bio", { user_id: userId });
      if (bioRes.error) throw new SupabaseDataError("profile_bio", bioRes.error.code);
      return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: typeof bioRes.data === "string" ? bioRes.data : "",
      };
    },

    async getUserProfile(viewerId, username) {
      const q = username.trim();
      // Same format as find_profile(). Invalid input never becomes a filter.
      if (!USERNAME_RE.test(q)) return null;
      const client = await getClient();
      // Case-insensitive exact match. ilike is wrong here: "_" is a LIKE
      // wildcard and usernames may contain it. imatch is ~*, and the pattern
      // is anchored. public_profiles is security invoker, so RLS applies.
      // Do not call find_profile(): that function is security definer and
      // returns a row even when this caller's RLS would hide the profile.
      const row = check(
        "public_profiles username",
        await client
          .from("public_profiles")
          .select(PROFILE_COLS)
          .filter("username", "imatch", `^${q}$`)
          .maybeSingle(),
      ) as ProfileRow | null;
      if (!row) return null;

      // Bio is friends-only (012): profile_bio() returns text for the owner
      // and accepted friends, and null otherwise. Logged-out viewers are not
      // offered the call. 42501 (anon, or execute revoked) hides the bio.
      let bio: string | null = null;
      if (viewerId) {
        const bioRes = await client.rpc("profile_bio", { user_id: row.id });
        if (bioRes.error) {
          if (bioRes.error.code !== "42501") {
            throw new SupabaseDataError("profile_bio", bioRes.error.code);
          }
        } else if (typeof bioRes.data === "string") {
          bio = bioRes.data;
        }
      }

      // No visibility predicate here. can_view_deck (RLS) decides: friends
      // see public and friends-only decks, and a private fork of a deck they
      // own (009); everyone else sees public decks; the owner sees all of
      // theirs. An app-side "not private" filter would hide that 009 case.
      const deckRows = check(
        "profile decks",
        await client
          .from("decks")
          .select(DECK_COLS)
          .eq("owner_id", row.id)
          .order("updated_at", { ascending: false }),
      ) as DeckRow[] | null;
      const decks = await decorate(client, (deckRows ?? []).map(toDeck), false);
      return {
        profile: { ...toProfile(row), bio },
        decks: decks.sort(byUpdatedDesc),
      };
    },
  };
}
