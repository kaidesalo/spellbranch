import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";

// Local JSON-store adapter against an in-memory store: same behaviour as
// before PR 3, plus the P2 friend-request rules.

let db: DataStore;
vi.mock("@/lib/data/store", () => ({
  readStore: async () => structuredClone(db),
  // Like the real store: nothing is written if the updater throws.
  updateStore: async <T>(fn: (s: DataStore) => T | Promise<T>) => {
    const copy = structuredClone(db);
    const result = await fn(copy);
    db = copy;
    return result;
  },
}));

let sessionUser: { id: string; email: string; username: string; displayName: string } | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const { localRepository: repo } = await import("@/lib/data/local");
const { DataError } = await import("@/lib/data/errors");
const { FRIEND_MESSAGES } = await import("@/lib/data/friend-rules");

const T = "2026-10-20T14:00:00.000Z";
const user = (id: string, username: string, email: string): LocalUser => ({
  id,
  username,
  displayName: username.toUpperCase(),
  email,
  bio: "secret bio",
  avatarUrl: null,
  passwordHash: "salt:hash",
  createdAt: T,
});

beforeEach(() => {
  sessionUser = null;
  db = {
    users: [
      user("alice", "alice_u", "alice@corp.example"),
      user("bob", "bob_u", "bob@corp.example"),
      user("carol", "carol_u", "carol@corp.example"),
    ],
    friendships: [],
    favorites: [],
    decks: [],
    deckCards: [],
    comments: [],
    sessions: {},
  };
});

async function rejectsWith(p: Promise<unknown>, message: string) {
  await expect(p).rejects.toBeInstanceOf(DataError);
  await expect(p).rejects.toThrow(message);
}

const card = {
  scryfallId: "s1", cardName: "Sol Ring", imageUri: "https://cards.scryfall.io/normal/front/x.jpg",
  manaCost: "{1}", typeLine: "Artifact", colors: [], oracleText: null, quantity: 1,
};

describe("local adapter: decks, cards, forks, compare", () => {
  it("create, add cards, fork, compare, preferred branch", async () => {
    const id = await repo.createDeck("alice", {
      name: "Alice", format: "modern", notes: "n", visibility: "public", allowForks: true,
    });
    await repo.addCard("alice", id, card);
    await repo.addCard("alice", id, { ...card, quantity: 2 });
    let deck = await repo.getDeck(null, id);
    expect(deck?.cardCount).toBe(3);
    expect(deck?.owner).toEqual({ id: "alice", username: "alice_u", displayName: "ALICE_U", avatarUrl: null });

    await rejectsWith(repo.addCard("bob", id, card), "You cannot edit this deck");

    const forkId = await repo.forkDeck("bob", id);
    const fork = await repo.getDeck("bob", forkId);
    expect(fork).toMatchObject({ ownerId: "bob", forkedFromId: id, visibility: "friends", cardCount: 3 });

    const cardId = fork!.cards![0].id;
    await repo.setCardQuantity("bob", forkId, cardId, 1);
    // The source is untouched.
    expect((await repo.getDeck(null, id))?.cardCount).toBe(3);

    // The branch is friends-only: Alice can't compare it until they're friends.
    expect(await repo.getCompareData("alice", id, forkId)).toBeNull();
    await repo.sendFriendRequest("bob", "alice");
    await repo.respondFriendRequest("alice", db.friendships[0].id, true);
    const cmp = await repo.getCompareData("alice", id, forkId);
    expect(cmp?.canSetPreferred).toBe(true);
    expect(cmp?.branch.cardCount).toBe(1);
    expect(await repo.getCompareData("alice", forkId, id)).toBeNull();

    await rejectsWith(repo.setPreferredBranch("bob", id, forkId), "Only the source deck owner");
    await repo.setPreferredBranch("alice", id, forkId);
    deck = await repo.getDeck(null, id);
    expect(deck?.preferredBranchId).toBe(forkId);
  });

  it("visibility and fork permissions are enforced", async () => {
    const id = await repo.createDeck("alice", {
      name: "Secret", format: "modern", notes: "", visibility: "friends", allowForks: false,
    });
    expect(await repo.getDeck("bob", id)).toBeNull();
    expect(await repo.getDeck(null, id)).toBeNull();
    await rejectsWith(repo.forkDeck("bob", id), "You are not allowed to fork this deck");
    expect(await repo.getDeckPermissions("bob", id)).toEqual({ canEdit: false, canFork: false, canComment: false });
    expect(await repo.getDeckPermissions("alice", id)).toEqual({ canEdit: true, canFork: true, canComment: true });
    expect(await repo.listDecks(null, "public")).toEqual([]);
  });

  it("delete keeps forks (source pointer cleared) and removes comments", async () => {
    const id = await repo.createDeck("alice", {
      name: "A", format: "modern", notes: "", visibility: "public", allowForks: true,
    });
    const forkId = await repo.forkDeck("bob", id);
    await repo.addComment("bob", id, "hi");
    await rejectsWith(repo.deleteDeck("bob", id), "You cannot delete this deck");
    await repo.deleteDeck("alice", id);
    expect(db.comments).toEqual([]);
    expect(db.decks.find((d) => d.id === forkId)?.forkedFromId).toBeNull();
  });

  it("drops non-Scryfall image URLs", async () => {
    const id = await repo.createDeck("alice", {
      name: "A", format: "modern", notes: "", visibility: "private", allowForks: true,
    });
    await repo.addCard("alice", id, { ...card, imageUri: "https://evil.example/pixel.png" });
    expect(db.deckCards[0].imageUri).toBeNull();
  });
});

describe("local adapter: comments and favorites", () => {
  it("comments need deck access; authors carry no email", async () => {
    const id = await repo.createDeck("alice", {
      name: "A", format: "modern", notes: "", visibility: "private", allowForks: true,
    });
    await rejectsWith(repo.addComment("bob", id, "hi"), "You cannot comment on this deck");
    await repo.addComment("alice", id, "mine");
    const comments = await repo.listComments("alice", id);
    expect(comments[0].author).toEqual({ id: "alice", username: "alice_u", displayName: "ALICE_U" });
    expect(await repo.listComments("bob", id)).toEqual([]);
    expect(JSON.stringify(comments)).not.toMatch(/email|corp\.example/);
  });

  it("favorites are per user and de-duplicated", async () => {
    const fav = { scryfallId: "s1", cardName: "Sol Ring", imageUri: null, manaCost: null, typeLine: null };
    await repo.addFavorite("alice", fav);
    await repo.addFavorite("alice", fav);
    expect(await repo.listFavorites("alice")).toHaveLength(1);
    expect(await repo.listFavorites("bob")).toHaveLength(0);
    const [f] = await repo.listFavorites("alice");
    await repo.removeFavorite("bob", f.id);
    expect(await repo.listFavorites("alice")).toHaveLength(1);
    await repo.removeFavorite("alice", f.id);
    expect(await repo.listFavorites("alice")).toHaveLength(0);
  });
});

describe("local adapter: friend search is exact", () => {
  it("matches the whole username, case-insensitively, 0 or 1 result, never yourself", async () => {
    expect(await repo.findProfile("alice", "BOB_U")).toEqual([
      { id: "bob", username: "bob_u", displayName: "BOB_U", avatarUrl: null },
    ]);
    expect(await repo.findProfile("alice", "bob")).toEqual([]);
    expect(await repo.findProfile("alice", "b")).toEqual([]);
    expect(await repo.findProfile("alice", "BOB")).toEqual([]); // display name isn't searched
    expect(await repo.findProfile("alice", "alice_u")).toEqual([]);
    expect(await repo.findProfile("alice", "%_u")).toEqual([]);
  });
});

describe("local adapter: friend requests (P2)", () => {
  it("request -> decline -> no re-send; the old row stays declined", async () => {
    await repo.sendFriendRequest("alice", "bob");
    const [f] = db.friendships;
    await rejectsWith(repo.respondFriendRequest("alice", f.id, true), FRIEND_MESSAGES.requestNotFound);
    await repo.respondFriendRequest("bob", f.id, false);

    await rejectsWith(repo.sendFriendRequest("alice", "bob"), FRIEND_MESSAGES.declined);
    expect(db.friendships).toEqual([{ ...f, status: "declined" }]);

    // The requester can't clear it either; the addressee can't answer twice.
    await rejectsWith(repo.removeFriendship("alice", f.id), FRIEND_MESSAGES.cannotRemove);
    await rejectsWith(repo.respondFriendRequest("bob", f.id, true), FRIEND_MESSAGES.requestNotFound);
    expect((await repo.getFriendsData("alice")).outgoing).toEqual([]);
  });

  it("the user who declined can send their own request (fresh pending row)", async () => {
    await repo.sendFriendRequest("alice", "bob");
    await repo.respondFriendRequest("bob", db.friendships[0].id, false);
    await repo.sendFriendRequest("bob", "alice");
    expect(db.friendships).toHaveLength(1);
    expect(db.friendships[0]).toMatchObject({ requesterId: "bob", addresseeId: "alice", status: "pending" });
  });

  it("accept, then either side unfriends", async () => {
    await repo.sendFriendRequest("alice", "bob");
    await rejectsWith(repo.sendFriendRequest("alice", "bob"), FRIEND_MESSAGES.alreadySent);
    await rejectsWith(repo.sendFriendRequest("bob", "alice"), FRIEND_MESSAGES.theyAsked);
    const id = db.friendships[0].id;
    await repo.respondFriendRequest("bob", id, true);
    await rejectsWith(repo.sendFriendRequest("bob", "alice"), FRIEND_MESSAGES.alreadyFriends);

    const data = await repo.getFriendsData("alice");
    expect(data.friends.map((r) => r.profile.username)).toEqual(["bob_u"]);
    expect(JSON.stringify(data)).not.toMatch(/email|corp\.example|secret bio/);

    await repo.removeFriendship("alice", id);
    expect(db.friendships).toEqual([]);
  });

  it("requester cancels a pending request; strangers can't touch it", async () => {
    await repo.sendFriendRequest("alice", "bob");
    const id = db.friendships[0].id;
    await rejectsWith(repo.removeFriendship("carol", id), FRIEND_MESSAGES.requestNotFound);
    await rejectsWith(repo.respondFriendRequest("carol", id, true), FRIEND_MESSAGES.requestNotFound);
    await repo.removeFriendship("alice", id);
    expect(db.friendships).toEqual([]);
  });

  it("addressee may clear a declined row", async () => {
    await repo.sendFriendRequest("alice", "bob");
    const id = db.friendships[0].id;
    await repo.respondFriendRequest("bob", id, false);
    await repo.removeFriendship("bob", id);
    expect(db.friendships).toEqual([]);
  });

  it("self and unknown users are refused", async () => {
    await rejectsWith(repo.sendFriendRequest("alice", "alice"), FRIEND_MESSAGES.self);
    await rejectsWith(repo.sendFriendRequest("alice", "nobody"), FRIEND_MESSAGES.notFound);
    expect(db.friendships).toEqual([]);
  });
});

describe("friend actions use the same rules", () => {
  it("sendFriendRequestAction shows 'request declined' after a decline", async () => {
    const actions = await import("@/lib/actions/friends");
    const as = (id: string) => {
      const u = db.users.find((x) => x.id === id)!;
      sessionUser = { id, email: u.email, username: u.username, displayName: u.displayName };
    };
    as("alice");
    expect(await actions.sendFriendRequestAction("bob")).toEqual({ success: true });
    as("bob");
    const incoming = (await repo.getFriendsData("bob")).incoming;
    expect(await actions.respondFriendRequestAction(incoming[0].friendship.id, false)).toEqual({ success: true });
    as("alice");
    expect(await actions.sendFriendRequestAction("bob")).toEqual({ error: FRIEND_MESSAGES.declined });
    expect(await actions.findProfileAction("bob_u")).toHaveLength(1);
    expect(await actions.findProfileAction("bo")).toEqual([]);
  });
});
