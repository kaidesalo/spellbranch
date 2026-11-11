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
  ORIGINAL_DECK_FORKS_LOCKED,
  areFriends,
  canCommentOnDeck,
  canEditDeck,
  canForkDeck,
  canViewDeck,
  canViewProfile,
} from "@/lib/permissions";
import { toPublicProfile } from "@/lib/data/profiles";
import { defaultBranchName, defaultCopyName, requireForkName } from "@/lib/fork-name";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit/messages";
import type { CopyLink, Deck, DeckCard, DeckWithMeta, Friendship } from "@/lib/types";

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
function decorateDeck(
  store: DataStore,
  deck: Deck,
  viewerId: string | null,
  withSourceBranches = false,
): DeckWithMeta {
  const cards = store.deckCards.filter((c) => c.deckId === deck.id);
  const branches = store.decks
    .filter((d) => d.forkedFromId === deck.id && canViewDeck(store, d, viewerId))
    .map((d) => ({ ...d, owner: ownerProfile(store, d.ownerId) }));
  const source = deck.forkedFromId
    ? store.decks.find((d) => d.id === deck.forkedFromId)
    : undefined;
  const sourceDeck =
    source && canViewDeck(store, source, viewerId)
      ? { ...source, owner: ownerProfile(store, source.ownerId) }
      : null;
  // Siblings for the branch menu on a deck page. The source row is not
  // included; a hidden source stays out even though its id is on this deck.
  // List views skip this so they don't carry every sibling's notes.
  const sourceBranches =
    withSourceBranches && deck.forkedFromId
      ? store.decks
          .filter((d) => d.forkedFromId === deck.forkedFromId && canViewDeck(store, d, viewerId))
          .map((d) => ({ ...d, owner: ownerProfile(store, d.ownerId) }))
      : undefined;
  const preferredBranchId =
    deck.preferredBranchId && branches.some((b) => b.id === deck.preferredBranchId)
      ? deck.preferredBranchId
      : null;
  // A copy's source id is only attached when the viewer can see that deck.
  // A hidden or missing source looks the same as a deck that is not a copy.
  // The two owners still get the name and handle through copyLinks.
  const rawCopyId = deck.copiedFromId ?? null;
  const copySource = rawCopyId
    ? store.decks.find((d) => d.id === rawCopyId)
    : undefined;
  const copiedFromDeck =
    copySource && canViewDeck(store, copySource, viewerId)
      ? { ...copySource, owner: ownerProfile(store, copySource.ownerId) }
      : null;
  // Deck page only. List responses stay free of the cross-link.
  const copyLinks = withSourceBranches ? copyLinksFor(store, deck, viewerId) : undefined;

  return {
    ...deck,
    copiedFromId: copiedFromDeck ? rawCopyId : null,
    copiedFromDeck,
    copySourceUnavailable: false,
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
    sourceBranches,
    ...(copyLinks && copyLinks.length > 0 ? { copyLinks } : {}),
  };
}

/**
 * The other side of a copy, for the two owners only. Name and handle, not
 * cards or notes. `visible` follows normal deck visibility.
 */
function copyLinksFor(store: DataStore, deck: Deck, viewerId: string | null): CopyLink[] {
  if (!viewerId || !canViewDeck(store, deck, viewerId)) return [];
  const links: CopyLink[] = [];
  if (deck.copiedFromId) {
    const source = store.decks.find((d) => d.id === deck.copiedFromId);
    if (source && (viewerId === deck.ownerId || viewerId === source.ownerId)) {
      links.push(copyLink(store, source, viewerId, "original"));
    }
  }
  for (const copy of store.decks) {
    if (copy.copiedFromId !== deck.id) continue;
    if (viewerId !== deck.ownerId && viewerId !== copy.ownerId) continue;
    links.push(copyLink(store, copy, viewerId, "copy"));
  }
  return links.sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === "original" ? -1 : 1) ||
      a.name.localeCompare(b.name, "en") ||
      a.id.localeCompare(b.id),
  );
}

function copyLink(
  store: DataStore,
  other: Deck,
  viewerId: string,
  role: CopyLink["role"],
): CopyLink {
  return {
    id: other.id,
    name: other.name,
    ownerId: other.ownerId,
    username: ownerProfile(store, other.ownerId)?.username ?? null,
    role,
    visible: canViewDeck(store, other, viewerId),
  };
}

const byUpdatedDesc = (a: Deck, b: Deck) => b.updatedAt.localeCompare(a.updatedAt);

/** Keep in step with enforce_fork_copy_rate() in migration 010. */
const FORK_COPY_LIMIT = 20;
const FORK_COPY_WINDOW_MS = 10 * 60 * 1000;

/**
 * One bucket for forks and copies. Throws before the new deck is inserted.
 * A thrown error leaves the store unchanged, matching the database rollback.
 */
function chargeForkCopy(store: DataStore, userId: string, nowMs: number) {
  const recent = (store.forkCopyHits ?? []).filter(
    (hit) => nowMs - Date.parse(hit.at) < FORK_COPY_WINDOW_MS,
  );
  const mine = recent.filter((hit) => hit.userId === userId);
  if (mine.length >= FORK_COPY_LIMIT) throw new DataError(RATE_LIMITED_MESSAGE);
  store.forkCopyHits = [...recent, { userId, at: new Date(nowMs).toISOString() }];
}

/** The deck's colors as stored; null (no colors picked) for older decks. */
function deckColors(deck: Deck): string[] | null {
  return Array.isArray(deck.colors) ? normalizeDeckColors(deck.colors) : null;
}

/** F4: a derivative of a public deck is friends-only and forkable; anything else starts private and locked. */
function derivativeVisibility(source: Deck): { visibility: Deck["visibility"]; allowForks: boolean } {
  return source.visibility === "public"
    ? { visibility: "friends", allowForks: true }
    : { visibility: "private", allowForks: false };
}

/**
 * The original deck for a branch. A root (no forkedFromId) is its own root.
 * A cycle is refused. A missing parent keeps the stored id, matching a
 * forked_from_id that no longer has a row.
 */
function branchRootId(store: DataStore, source: Deck): string {
  let current = source;
  const seen = new Set<string>();
  while (current.forkedFromId) {
    if (seen.has(current.id)) throw new DataError("You are not allowed to fork this deck");
    seen.add(current.id);
    const parent = store.decks.find((d) => d.id === current.forkedFromId);
    if (!parent) return current.forkedFromId;
    if (!parent.forkedFromId) return parent.id;
    current = parent;
  }
  return current.id;
}

/**
 * A new fork has to be allowed on the original deck, not only on the branch
 * that was clicked. "hidden" and "locked" are different answers: a root the
 * caller cannot see gets the same refusal as any other forbidden fork.
 */
function rootForkBlock(
  store: DataStore,
  source: Deck,
  userId: string,
): "ok" | "hidden" | "locked" {
  const rootId = branchRootId(store, source);
  const root = store.decks.find((d) => d.id === rootId);
  if (!root || !canViewDeck(store, root, userId)) return "hidden";
  if (root.ownerId !== userId && !root.allowForks) return "locked";
  return "ok";
}

function cloneCards(store: DataStore, fromId: string, toId: string, now: string) {
  for (const card of store.deckCards.filter((c) => c.deckId === fromId)) {
    const copy: DeckCard = { ...card, id: uuidv4(), deckId: toId, createdAt: now };
    store.deckCards.push(copy);
  }
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

  async listFriendBranchesOnMyDecks(userId) {
    const store = await readStore();
    const owned = new Set(
      store.decks.filter((d) => d.ownerId === userId).map((d) => d.id),
    );
    return store.decks
      .filter((d) => {
        if (!d.forkedFromId || !owned.has(d.forkedFromId)) return false;
        return (
          d.ownerId !== userId &&
          areFriends(store.friendships, userId, d.ownerId) &&
          canViewDeck(store, d, userId)
        );
      })
      .map((d) => decorateDeck(store, d, userId))
      .sort(byUpdatedDesc);
  },

  async getDeck(viewerId, deckId) {
    const store = await readStore();
    const deck = store.decks.find((d) => d.id === deckId);
    if (!deck || !canViewDeck(store, deck, viewerId)) return null;
    return decorateDeck(store, deck, viewerId, true);
  },

  async getCompareData(viewerId, sourceId, branchId) {
    const store = await readStore();
    const source = store.decks.find((d) => d.id === sourceId);
    const branch = store.decks.find((d) => d.id === branchId);
    if (!source || !branch) return null;
    if (!canViewDeck(store, source, viewerId)) return null;
    if (!canViewDeck(store, branch, viewerId)) return null;
    const isFork = branch.forkedFromId === source.id;
    const isCopy = !branch.forkedFromId && (branch.copiedFromId ?? null) === source.id;
    if (!isFork && !isCopy) return null;

    return {
      source: decorateDeck(store, source, viewerId),
      branch: decorateDeck(store, branch, viewerId),
      canSetPreferred: isFork && canEditDeck(source, viewerId),
      copy: isCopy,
    };
  },

  async getDeckPermissions(viewerId, deckId) {
    const store = await readStore();
    const deck = store.decks.find((d) => d.id === deckId);
    if (!deck) return { canEdit: false, canFork: false, canCopy: false, canComment: false };
    const canCopy = canForkDeck(store, deck, viewerId);
    const canFork =
      canCopy &&
      (!deck.forkedFromId || !viewerId || rootForkBlock(store, deck, viewerId) === "ok");
    return {
      canEdit: canEditDeck(deck, viewerId),
      canFork,
      canCopy,
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
        copiedFromId: null,
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
        // Copies lose the compare link when the source is deleted (SET NULL).
        if (d.copiedFromId === deckId) d.copiedFromId = null;
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

  async forkDeck(userId, deckId, name) {
    return updateStore((store) => {
      const source = store.decks.find((d) => d.id === deckId);
      if (!source || !canForkDeck(store, source, userId)) {
        throw new DataError("You are not allowed to fork this deck");
      }
      // The original deck can refuse forks even when this branch still
      // allows them. Checked before the name so a bad name cannot confirm
      // that a hidden root exists.
      if (source.forkedFromId) {
        const block = rootForkBlock(store, source, userId);
        if (block === "locked") throw new DataError(ORIGINAL_DECK_FORKS_LOCKED);
        if (block !== "ok") throw new DataError("You are not allowed to fork this deck");
      }
      // Checked after the permission test so a bad name can't confirm that a
      // hidden deck exists. Omitted: the same suffix fork_deck() writes.
      const forkName = name === undefined ? defaultBranchName(source.name) : requireForkName(name);
      const now = new Date().toISOString();
      chargeForkCopy(store, userId, Date.parse(now));
      const newId = uuidv4();
      // Same rule as fork_deck() in the database (review F4). The new row
      // joins the original deck's branch list, not the deck that was clicked
      // when that deck is itself a branch (010).
      const { visibility, allowForks } = derivativeVisibility(source);
      store.decks.push({
        id: newId,
        ownerId: userId,
        name: forkName,
        format: source.format,
        notes: source.notes,
        visibility,
        allowForks,
        forkedFromId: branchRootId(store, source),
        copiedFromId: null,
        preferredBranchId: null,
        // The commander and colors carry over like the cards (fork_deck() too).
        commander: source.commander ? { ...source.commander } : null,
        colors: deckColors(source),
        createdAt: now,
        updatedAt: now,
      });
      cloneCards(store, source.id, newId, now);
      return newId;
    });
  },

  async copyDeck(userId, deckId, name) {
    return updateStore((store) => {
      const source = store.decks.find((d) => d.id === deckId);
      if (!source || !canForkDeck(store, source, userId)) {
        throw new DataError("You are not allowed to copy this deck");
      }
      const copyName = name === undefined ? defaultCopyName(source.name) : requireForkName(name);
      const now = new Date().toISOString();
      chargeForkCopy(store, userId, Date.parse(now));
      const newId = uuidv4();
      // A copy is a new root. It keeps a source pointer for compare and does
      // not join the source's branch list. Visibility matches fork_deck().
      const { visibility, allowForks } = derivativeVisibility(source);
      store.decks.push({
        id: newId,
        ownerId: userId,
        name: copyName,
        format: source.format,
        notes: source.notes,
        visibility,
        allowForks,
        forkedFromId: null,
        copiedFromId: source.id,
        preferredBranchId: null,
        commander: source.commander ? { ...source.commander } : null,
        colors: deckColors(source),
        createdAt: now,
        updatedAt: now,
      });
      cloneCards(store, source.id, newId, now);
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

  async getUserProfile(viewerId, username) {
    const q = username.trim();
    if (!USERNAME_RE.test(q)) return null;
    const store = await readStore();
    const user = store.users.find((u) => u.username.toLowerCase() === q.toLowerCase());
    if (!user || !canViewProfile(store, user.id, viewerId)) return null;
    const decks = store.decks
      .filter((d) => d.ownerId === user.id && canViewDeck(store, d, viewerId))
      .map((d) => decorateDeck(store, d, viewerId))
      .sort(byUpdatedDesc);
    return {
      profile: {
        ...toPublicProfile(user),
        // Logged-out visitors match anon: no grant on profiles.bio.
        bio: viewerId ? (user.bio ?? "") : null,
      },
      decks,
    };
  },
};
