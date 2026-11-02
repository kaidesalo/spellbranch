import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMANDER_MESSAGES, DataError } from "@/lib/data/errors";
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
import type {
  Comment,
  Deck,
  DeckCard,
  DeckCommander,
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
 * - Forks go through rpc('fork_deck'); friend lookup through
 *   rpc('find_profile') (exact username, 0 or 1 rows).
 * - Deck inserts never send forked_from_id / preferred_branch_id:
 *   enforce_deck_links() rejects preferred_branch_id on API INSERTs, so a
 *   preferred branch is only ever set by a later UPDATE (setPreferredBranch).
 * - Ids from the client are checked to be UUIDs first and are only passed as
 *   bound filter values (.eq/.in), never interpolated into .or() strings.
 */

type Client = SupabaseClient;
export type ClientFactory = () => Promise<Client>;

type PgError = { code?: string; message?: string } | null;

// The commander_* columns come from migration 006: apply it before deploying
// this version (PostgREST rejects a select of unknown columns).
// (One string literal: supabase-js types the result from it.)
const DECK_COLS =
  "id, owner_id, name, format, notes, visibility, allow_forks, forked_from_id, preferred_branch_id, commander_scryfall_id, commander_name, commander_type_line, commander_mana_cost, commander_image_uri, commander_art_uri, commander_color_identity, created_at, updated_at";
const CARD_COLS =
  "id, deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, oracle_text, quantity, created_at";
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
  oracle_text: string | null;
  quantity: number;
  created_at: string;
};
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
  preferredBranchId: r.preferred_branch_id,
  commander: toCommander(r),
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
  oracleText: r.oracle_text,
  quantity: r.quantity,
  createdAt: r.created_at,
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

/** Adds owner, card counts (and cards), branches and source, all under RLS. */
async function decorate(
  client: Client,
  decks: Deck[],
  withCards: boolean,
): Promise<DeckWithMeta[]> {
  if (decks.length === 0) return [];
  const ids = decks.map((d) => d.id);
  const sourceIds = uniq(decks.map((d) => d.forkedFromId));

  const [cardsRes, branchesRes, sourcesRes, owners] = await Promise.all([
    client
      .from("deck_cards")
      .select(withCards ? CARD_COLS : "deck_id, quantity")
      .in("deck_id", ids),
    client.from("decks").select(DECK_COLS).in("forked_from_id", ids),
    sourceIds.length
      ? client.from("decks").select(DECK_COLS).in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    loadProfiles(client, uniq(decks.map((d) => d.ownerId))),
  ]);

  const cardRows = (check("deck_cards", cardsRes) ?? []) as unknown as CardRow[];
  const branches = ((check("decks", branchesRes) ?? []) as DeckRow[]).map(toDeck);
  const sources = ((check("decks", sourcesRes) ?? []) as DeckRow[]).map(toDeck);

  return decks.map((deck) => {
    const mine = cardRows.filter((c) => c.deck_id === deck.id);
    const deckBranches = branches.filter((b) => b.forkedFromId === deck.id);
    // RLS already hides branches the viewer can't see; a preferred branch
    // among them is reported as null so pages never link to it (review L1).
    const preferredBranchId =
      deck.preferredBranchId && deckBranches.some((b) => b.id === deck.preferredBranchId)
        ? deck.preferredBranchId
        : null;
    return {
      ...deck,
      preferredBranchId,
      owner: owners.get(deck.ownerId),
      cards: withCards ? mine.map(toCard) : undefined,
      cardCount: mine.reduce((sum, c) => sum + c.quantity, 0),
      forkCount: deckBranches.length,
      sourceDeck: deck.forkedFromId
        ? (sources.find((s) => s.id === deck.forkedFromId) ?? null)
        : null,
      branches: deckBranches,
    };
  });
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

    async getDeck(_viewerId, deckId) {
      const client = await getClient();
      const deck = await fetchDeck(client, deckId);
      if (!deck) return null;
      const [decorated] = await decorate(client, [deck], true);
      return decorated;
    },

    async getCompareData(viewerId, sourceId, branchId) {
      const client = await getClient();
      const [source, branch] = await Promise.all([
        fetchDeck(client, sourceId),
        fetchDeck(client, branchId),
      ]);
      if (!source || !branch || branch.forkedFromId !== source.id) return null;
      const [s, b] = await decorate(client, [source, branch], true);
      return { source: s, branch: b, canSetPreferred: Boolean(viewerId) && source.ownerId === viewerId };
    },

    async getDeckPermissions(viewerId, deckId) {
      const none = { canEdit: false, canFork: false, canComment: false };
      const client = await getClient();
      const deck = await fetchDeck(client, deckId); // visible under RLS, or null
      if (!deck || !viewerId) return none;
      const isOwner = deck.ownerId === viewerId;
      return { canEdit: isOwner, canFork: isOwner || deck.allowForks, canComment: true };
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
          })
          .select("id")
          .single(),
      ) as { id: string };
      return row.id;
    },

    async updateDeck(userId, deckId, input) {
      if (!isUuid(deckId)) throw new DataError("You cannot edit this deck");
      const client = await getClient();
      const rows = check(
        "decks update",
        await client
          .from("decks")
          .update({
            name: input.name,
            format: input.format,
            notes: input.notes,
            visibility: input.visibility,
            allow_forks: input.allowForks,
            // Leaving Commander clears the commander in the same UPDATE, so
            // decks_commander_format (commander => format = 'commander')
            // never rejects a format change.
            ...(input.format === "commander" ? {} : commanderColumns(null)),
          })
          .eq("id", deckId)
          .eq("owner_id", userId)
          .select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError("You cannot edit this deck");
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
      let query = client
        .from("decks")
        .update(commanderColumns(commander))
        .eq("id", deckId)
        .eq("owner_id", userId);
      // Guards a format change racing this write; the CHECK is the backstop.
      if (commander) query = query.eq("format", "commander");
      const { data, error } = await query.select("id");
      if (error) {
        // 23514: one of the decks_commander_* CHECKs (format or type line).
        if (error.code === "23514") throw new DataError(COMMANDER_MESSAGES.notLegendaryCreature);
        throw new SupabaseDataError("decks commander", error.code);
      }
      if (!data?.length) {
        throw new DataError(commander ? COMMANDER_MESSAGES.notCommanderFormat : denied);
      }
    },

    async deleteDeck(userId, deckId) {
      if (!isUuid(deckId)) throw new DataError("You cannot delete this deck");
      const client = await getClient();
      // Cards and comments cascade; forks keep their cards and get
      // forked_from_id = null (ON DELETE SET NULL), like local mode.
      const rows = check(
        "decks delete",
        await client.from("decks").delete().eq("id", deckId).eq("owner_id", userId).select("id"),
      ) as { id: string }[] | null;
      if (!rows?.length) throw new DataError("You cannot delete this deck");
    },

    async addCard(userId, deckId, card) {
      const client = await getClient();
      await requireOwnDeck(client, userId, deckId, "You cannot edit this deck");
      const existing = check(
        "deck_cards find",
        await client
          .from("deck_cards")
          .select("id, quantity")
          .eq("deck_id", deckId)
          .eq("scryfall_id", card.scryfallId)
          .maybeSingle(),
      ) as { id: string; quantity: number } | null;

      if (existing) {
        check(
          "deck_cards update",
          await client
            .from("deck_cards")
            .update({ quantity: Math.min(99, existing.quantity + card.quantity) })
            .eq("id", existing.id),
        );
      } else {
        check(
          "deck_cards insert",
          await client.from("deck_cards").insert({
            deck_id: deckId,
            scryfall_id: card.scryfallId,
            card_name: card.cardName,
            image_uri: scryfallImageOrNull(card.imageUri),
            mana_cost: card.manaCost,
            type_line: card.typeLine,
            colors: card.colors,
            oracle_text: card.oracleText,
            quantity: card.quantity,
          }),
        );
      }
      await touchDeck(client, deckId);
    },

    async setCardQuantity(userId, deckId, cardId, quantity) {
      const client = await getClient();
      await requireOwnDeck(client, userId, deckId, "You cannot edit this deck");
      if (!isUuid(cardId)) throw new DataError("Card not found in deck");
      if (quantity === 0) {
        check(
          "deck_cards delete",
          await client.from("deck_cards").delete().eq("id", cardId).eq("deck_id", deckId),
        );
      } else {
        const rows = check(
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

    async forkDeck(_userId, deckId) {
      const denied = "You are not allowed to fork this deck";
      if (!isUuid(deckId)) throw new DataError(denied);
      const client = await getClient();
      const { data, error } = await client.rpc("fork_deck", { source: deckId });
      if (error) {
        // 42501: not allowed (or invisible); P0002: not found. Same message.
        if (error.code === "42501" || error.code === "P0002") throw new DataError(denied);
        throw new SupabaseDataError("fork_deck", error.code);
      }
      if (typeof data !== "string") throw new SupabaseDataError("fork_deck", "bad-result");
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
      const row = check(
        "profiles own",
        await client
          .from("profiles")
          .select("id, username, display_name, bio")
          .eq("id", userId)
          .maybeSingle(),
      ) as { id: string; username: string; display_name: string; bio: string | null } | null;
      return row
        ? { id: row.id, username: row.username, displayName: row.display_name, bio: row.bio ?? "" }
        : null;
    },
  };
}
