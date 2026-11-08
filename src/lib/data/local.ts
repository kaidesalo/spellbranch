import "server-only";

import { v4 as uuidv4 } from "uuid";
import { readStore, updateStore, type DataStore } from "@/lib/data/store";
import { COMMANDER_MESSAGES, DataError } from "@/lib/data/errors";
import {
  assertCardFits,
  assertColorsFitDeck,
  assertQuantityRaiseFits,
  colorsForCommander,
} from "@/lib/data/deck-color-rules";
import { normalizeDeckColors } from "@/lib/deck-colors";
import { commanderProblem, normalizeCommander } from "@/lib/commander";
import {
  FRIEND_MESSAGES,
  canRemove,
  canRespond,
  decideSendRequest,
  findPair,
} from "@/lib/data/friend-rules";
import type { FriendRow, Repository } from "@/lib/data/types";
import { USERNAME_RE, scryfallImageOrNull } from "@/lib/data/validation";
import {
  canCommentOnDeck,
  canEditDeck,
  canForkDeck,
  canViewDeck,
} from "@/lib/permissions";
import { toPublicProfile } from "@/lib/data/profiles";
import type { Deck, DeckCard, DeckWithMeta, Friendship } from "@/lib/types";

/**
 * Local JSON store backend (.data/store.json, dev/demo only). The pre-PR-3
 * app logic moved out of src/lib/{queries,actions}, plus the P2 friend rules,
 * the F4 fork rule and visibility-filtered branches, matching Supabase mode.
 * Permissions are enforced here in app code (src/lib/permissions.ts).
 */

function ownerProfile(store: DataStore, id: string) {
  const u = store.users.find((x) => x.id === id);
  return u ? toPublicProfile(u) : undefined;
}

/**
 * Adds owner, cards, branches and source as seen by `viewerId` (null when
 * signed out). Like RLS in Supabase mode, only branches and a source deck the
 * viewer may see are included (Cipher PR #3 review, M1), and a preferred
 * branch the viewer can't see is reported as null (L1).
 */
function decorateDeck(store: DataStore, deck: Deck, viewerId: string | null): DeckWithMeta {
  const cards = store.deckCards.filter((c) => c.deckId === deck.id);
  const branches = store.decks
    .filter((d) => d.forkedFromId === deck.id && canViewDeck(store, d, viewerId))
    .map((d) => ({ ...d, owner: ownerProfile(store, d.ownerId) }));
  const source = deck.forkedFromId
    ? store.decks.find((d) => d.id === deck.forkedFromId)
    : undefined;
  const sourceDeck = source && canViewDeck(store, source, viewerId) ? source : null;
  const preferredBranchId =
    deck.preferredBranchId && branches.some((b) => b.id === deck.preferredBranchId)
      ? deck.preferredBranchId
      : null;

  return {
    ...deck,
    preferredBranchId,
    // Decks saved before the commander or colors features have no field at all.
    commander: deck.commander ?? null,
    colors: deckColors(deck),
    owner: ownerProfile(store, deck.ownerId),
    cards,
    cardCount: cards.reduce((sum, c) => sum + c.quantity, 0),
    forkCount: branches.length,
    sourceDeck,
    branches,
  };
}

const byUpdatedDesc = (a: Deck, b: Deck) => b.updatedAt.localeCompare(a.updatedAt);

/** The deck's colors as stored; null (no colors picked) for older decks. */
function deckColors(deck: Deck): string[] | null {
  return Array.isArray(deck.colors) ? normalizeDeckColors(deck.colors) : null;
}

function editableDeck(store: DataStore, deckId: string, userId: string, message: string): Deck {
  const deck = store.decks.find((d) => d.id === deckId);
  if (!deck || !canEditDeck(deck, userId)) throw new DataError(message);
  return deck;
}

export const localRepository: Repository = {
  async listDecks(viewerId, scope) {
    const store = await readStore();
    let decks = store.decks.filter((d) => canViewDeck(store, d, viewerId));

    if (scope === "mine") {
      if (!viewerId) return [];
      decks = decks.filter((d) => d.ownerId === viewerId && !d.forkedFromId);
    } else if (scope === "friends") {
      if (!viewerId) return [];
      decks = decks.filter((d) => d.ownerId !== viewerId && d.visibility === "friends");
    } else {
      decks = decks.filter((d) => d.visibility === "public" && !d.forkedFromId);
    }

    return decks.map((d) => decorateDeck(store, d, viewerId)).sort(byUpdatedDesc);
  },

  async listMyBranches(userId) {
    const store = await readStore();
    return store.decks
      .filter((d) => d.ownerId === userId && d.forkedFromId)
      .map((d) => decorateDeck(store, d, userId))
      .sort(byUpdatedDesc);
  },

  async listBranchesOnMyDecks(userId) {
    const store = await readStore();
    const owned = new Set(
      store.decks.filter((d) => d.ownerId === userId).map((d) => d.id),
    );
    return store.decks
      .filter((d) => {
        if (!d.forkedFromId || !owned.has(d.forkedFromId)) return false;
        return d.ownerId !== userId && canViewDeck(store, d, userId);
      })
      .map((d) => decorateDeck(store, d, userId))
      .sort(byUpdatedDesc);
  },

  async getDeck(viewerId, deckId) {
    const store = await readStore();
    const deck = store.decks.find((d) => d.id === deckId);
    if (!deck || !canViewDeck(store, deck, viewerId)) return null;
    return decorateDeck(store, deck, viewerId);
  },

  async getCompareData(viewerId, sourceId, branchId) {
    const store = await readStore();
    const source = store.decks.find((d) => d.id === sourceId);
    const branch = store.decks.find((d) => d.id === branchId);
    if (!source || !branch) return null;
    if (!canViewDeck(store, source, viewerId)) return null;
    if (!canViewDeck(store, branch, viewerId)) return null;
    if (branch.forkedFromId !== source.id) return null;

    return {
      source: decorateDeck(store, source, viewerId),
      branch: decorateDeck(store, branch, viewerId),
      canSetPreferred: canEditDeck(source, viewerId),
    };
  },

  async getDeckPermissions(viewerId, deckId) {
    const store = await readStore();
    const deck = store.decks.find((d) => d.id === deckId);
    if (!deck) return { canEdit: false, canFork: false, canComment: false };
    return {
      canEdit: canEditDeck(deck, viewerId),
      canFork: canForkDeck(store, deck, viewerId),
      canComment: canCommentOnDeck(store, deck, viewerId),
    };
  },

  async createDeck(userId, input) {
    const now = new Date().toISOString();
    const id = uuidv4();
    await updateStore((store) => {
      store.decks.push({
        id,
        ownerId: userId,
        ...input,
        colors: input.colors ? normalizeDeckColors(input.colors) : null,
        forkedFromId: null,
        preferredBranchId: null,
        commander: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    return id;
  },

  async updateDeck(userId, deckId, input) {
    await updateStore((store) => {
      const deck = editableDeck(store, deckId, userId, "You cannot edit this deck");
      const { colors, ...rest } = input;
      // Only Commander decks have a commander: leaving the format clears it
      // (same rule as the decks_commander_format CHECK in Supabase mode).
      const commander = rest.format === "commander" ? (deck.commander ?? null) : null;
      // No colors in the input: leave them as they are.
      const nextColors = colors ? normalizeDeckColors(colors) : deckColors(deck);
      if (colors) {
        assertColorsFitDeck(
          nextColors!,
          store.deckCards.filter((c) => c.deckId === deckId),
          commander,
        );
      }
      Object.assign(deck, rest, {
        commander,
        colors: nextColors,
        updatedAt: new Date().toISOString(),
      });
    });
  },

  async assertCanSetCommander(userId, deckId) {
    const store = await readStore();
    const deck = editableDeck(store, deckId, userId, "You cannot edit this deck");
    if (deck.format !== "commander") throw new DataError(COMMANDER_MESSAGES.notCommanderFormat);
  },

  async setCommander(userId, deckId, commander) {
    await updateStore((store) => {
      const deck = editableDeck(store, deckId, userId, "You cannot edit this deck");
      // Clearing is always allowed (a no-op outside Commander decks).
      if (commander && deck.format !== "commander") {
        throw new DataError(COMMANDER_MESSAGES.notCommanderFormat);
      }
      const problem = commander && commanderProblem(commander);
      if (problem) throw new DataError(COMMANDER_MESSAGES[problem]);
      const next = commander ? normalizeCommander(commander) : null;
      if (next) {
        deck.colors = colorsForCommander(
          next,
          deckColors(deck),
          store.deckCards.filter((c) => c.deckId === deckId),
        );
      }
      deck.commander = next;
      deck.updatedAt = new Date().toISOString();
    });
  },

  async deleteDeck(userId, deckId) {
    await updateStore((store) => {
      editableDeck(store, deckId, userId, "You cannot delete this deck");
      store.decks = store.decks.filter((d) => d.id !== deckId);
      store.deckCards = store.deckCards.filter((c) => c.deckId !== deckId);
      store.comments = store.comments.filter((c) => c.deckId !== deckId);
      for (const d of store.decks) {
        if (d.preferredBranchId === deckId) d.preferredBranchId = null;
        // Keep orphaned forks but clear the source pointer.
        if (d.forkedFromId === deckId) d.forkedFromId = null;
      }
    });
  },

  async addCard(userId, deckId, card) {
    await updateStore((store) => {
      const deck = editableDeck(store, deckId, userId, "You cannot edit this deck");
      const colorIdentity = normalizeDeckColors(card.colorIdentity);
      assertCardFits(card.cardName, colorIdentity, deckColors(deck));
      const existing = store.deckCards.find(
        (c) => c.deckId === deckId && c.scryfallId === card.scryfallId,
      );
      if (existing) {
        existing.quantity = Math.min(99, existing.quantity + card.quantity);
        existing.colorIdentity = colorIdentity;
      } else {
        store.deckCards.push({
          id: uuidv4(),
          deckId,
          ...card,
          colorIdentity,
          imageUri: scryfallImageOrNull(card.imageUri),
          createdAt: new Date().toISOString(),
        });
      }
      deck.updatedAt = new Date().toISOString();
    });
  },

  async setCardQuantity(userId, deckId, cardId, quantity) {
    await updateStore((store) => {
      const deck = editableDeck(store, deckId, userId, "You cannot edit this deck");
      if (quantity === 0) {
        store.deckCards = store.deckCards.filter(
          (c) => !(c.id === cardId && c.deckId === deckId),
        );
      } else {
        const card = store.deckCards.find((c) => c.id === cardId && c.deckId === deckId);
        if (!card) throw new DataError("Card not found in deck");
        if (quantity > card.quantity) assertQuantityRaiseFits(card, deckColors(deck));
        card.quantity = quantity;
      }
      deck.updatedAt = new Date().toISOString();
    });
  },

  async forkDeck(userId, deckId) {
    return updateStore((store) => {
      const source = store.decks.find((d) => d.id === deckId);
      if (!source || !canForkDeck(store, source, userId)) {
        throw new DataError("You are not allowed to fork this deck");
      }
      const now = new Date().toISOString();
      const newId = uuidv4();
      // Same rule as fork_deck() in the database (review F4): a fork of a
      // public deck is friends-only and forkable; a fork of a friends-only or
      // private deck starts private and can't be forked further, so a fork
      // never widens the source's audience.
      store.decks.push({
        id: newId,
        ownerId: userId,
        name: `${source.name} (branch)`,
        format: source.format,
        notes: source.notes,
        visibility: source.visibility === "public" ? "friends" : "private",
        allowForks: source.visibility === "public",
        forkedFromId: source.id,
        preferredBranchId: null,
        // The commander and colors carry over like the cards (fork_deck() too).
        commander: source.commander ? { ...source.commander } : null,
        colors: deckColors(source),
        createdAt: now,
        updatedAt: now,
      });
      for (const card of store.deckCards.filter((c) => c.deckId === source.id)) {
        const copy: DeckCard = { ...card, id: uuidv4(), deckId: newId, createdAt: now };
        store.deckCards.push(copy);
      }
      return newId;
    });
  },

  async setPreferredBranch(userId, sourceId, branchId) {
    await updateStore((store) => {
      const source = editableDeck(
        store,
        sourceId,
        userId,
        "Only the source deck owner can set a preferred branch",
      );
      if (branchId) {
        const branch = store.decks.find((d) => d.id === branchId);
        // Same answer for "missing", "not a fork of this deck" and "a fork
        // you can't see" (002's enforce_deck_links, review M1).
        if (!branch || branch.forkedFromId !== sourceId || !canViewDeck(store, branch, userId)) {
          throw new DataError("Branch does not belong to this deck");
        }
      }
      source.preferredBranchId = branchId;
      source.updatedAt = new Date().toISOString();
    });
  },

  async listComments(viewerId, deckId) {
    const store = await readStore();
    const deck = store.decks.find((d) => d.id === deckId);
    if (!deck || !canViewDeck(store, deck, viewerId)) return [];
    return store.comments
      .filter((c) => c.deckId === deckId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => {
        const author = store.users.find((u) => u.id === c.authorId);
        return {
          ...c,
          author: author
            ? { id: author.id, username: author.username, displayName: author.displayName }
            : null,
        };
      });
  },

  async addComment(userId, deckId, body) {
    await updateStore((store) => {
      const deck = store.decks.find((d) => d.id === deckId);
      if (!deck || !canCommentOnDeck(store, deck, userId)) {
        throw new DataError("You cannot comment on this deck");
      }
      store.comments.push({
        id: uuidv4(),
        deckId,
        authorId: userId,
        body,
        createdAt: new Date().toISOString(),
      });
    });
  },

  async listFavorites(userId) {
    const store = await readStore();
    return store.favorites
      .filter((f) => f.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async addFavorite(userId, input) {
    await updateStore((store) => {
      if (store.favorites.some((f) => f.userId === userId && f.scryfallId === input.scryfallId)) {
        return;
      }
      store.favorites.push({
        id: uuidv4(),
        userId,
        ...input,
        imageUri: scryfallImageOrNull(input.imageUri),
        createdAt: new Date().toISOString(),
      });
    });
  },

  async removeFavorite(userId, favoriteId) {
    await updateStore((store) => {
      store.favorites = store.favorites.filter(
        (f) => !(f.id === favoriteId && f.userId === userId),
      );
    });
  },

  async getFriendsData(userId) {
    const store = await readStore();
    const mine = store.friendships.filter(
      (f) => f.requesterId === userId || f.addresseeId === userId,
    );
    const rows = (pred: (f: Friendship) => boolean): FriendRow[] =>
      mine.filter(pred).flatMap((f) => {
        const otherId = f.requesterId === userId ? f.addresseeId : f.requesterId;
        const profile = ownerProfile(store, otherId);
        return profile ? [{ friendship: f, profile }] : [];
      });

    return {
      friends: rows((f) => f.status === "accepted"),
      incoming: rows((f) => f.status === "pending" && f.addresseeId === userId),
      outgoing: rows((f) => f.status === "pending" && f.requesterId === userId),
    };
  },

  async findProfile(userId, username) {
    const q = username.trim();
    if (!USERNAME_RE.test(q)) return [];
    const store = await readStore();
    const found = store.users.find(
      (u) => u.id !== userId && u.username.toLowerCase() === q.toLowerCase(),
    );
    return found ? [toPublicProfile(found)] : [];
  },

  async sendFriendRequest(userId, addresseeId) {
    if (userId === addresseeId) throw new DataError(FRIEND_MESSAGES.self);
    await updateStore((store) => {
      if (!store.users.some((u) => u.id === addresseeId)) {
        throw new DataError(FRIEND_MESSAGES.notFound);
      }
      const decision = decideSendRequest(
        findPair(store.friendships, userId, addresseeId),
        userId,
        addresseeId,
      );
      if (decision.kind === "error") throw new DataError(decision.message);
      if (decision.kind === "replace") {
        store.friendships = store.friendships.filter((f) => f.id !== decision.deleteId);
      }
      store.friendships.push({
        id: uuidv4(),
        requesterId: userId,
        addresseeId,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    });
  },

  async respondFriendRequest(userId, friendshipId, accept) {
    await updateStore((store) => {
      const f = store.friendships.find((x) => x.id === friendshipId);
      if (!f || !canRespond(f, userId)) throw new DataError(FRIEND_MESSAGES.requestNotFound);
      f.status = accept ? "accepted" : "declined";
    });
  },

  async removeFriendship(userId, friendshipId) {
    await updateStore((store) => {
      const f = store.friendships.find((x) => x.id === friendshipId);
      if (!f || (f.requesterId !== userId && f.addresseeId !== userId)) {
        throw new DataError(FRIEND_MESSAGES.requestNotFound);
      }
      if (!canRemove(f, userId)) throw new DataError(FRIEND_MESSAGES.cannotRemove);
      store.friendships = store.friendships.filter((x) => x.id !== friendshipId);
    });
  },

  async getOwnProfile(userId) {
    const store = await readStore();
    const u = store.users.find((x) => x.id === userId);
    return u ? { id: u.id, username: u.username, displayName: u.displayName, bio: u.bio } : null;
  },
};
