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
// Real UUIDs: the actions reject anything else (review L4).
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const CAROL = "a0000000-0000-4000-8000-000000000003";
const NOBODY = "a0000000-0000-4000-8000-0000000000ff";
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
      user(ALICE, "alice_u", "alice@corp.example"),
      user(BOB, "bob_u", "bob@corp.example"),
      user(CAROL, "carol_u", "carol@corp.example"),
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
    const id = await repo.createDeck(ALICE, {
      name: "Alice", format: "modern", notes: "n", visibility: "public", allowForks: true,
    });
    await repo.addCard(ALICE, id, card);
    await repo.addCard(ALICE, id, { ...card, quantity: 2 });
    let deck = await repo.getDeck(null, id);
    expect(deck?.cardCount).toBe(3);
    expect(deck?.owner).toEqual({ id: ALICE, username: "alice_u", displayName: "ALICE_U", avatarUrl: null });

    await rejectsWith(repo.addCard(BOB, id, card), "You cannot edit this deck");

    const forkId = await repo.forkDeck(BOB, id);
    const fork = await repo.getDeck(BOB, forkId);
    expect(fork).toMatchObject({ ownerId: BOB, forkedFromId: id, visibility: "friends", cardCount: 3 });

    const cardId = fork!.cards![0].id;
    await repo.setCardQuantity(BOB, forkId, cardId, 1);
    // The source is untouched.
    expect((await repo.getDeck(null, id))?.cardCount).toBe(3);

    // The branch is friends-only: Alice can't compare it until they're friends.
    expect(await repo.getCompareData(ALICE, id, forkId)).toBeNull();
    await repo.sendFriendRequest(BOB, ALICE);
    await repo.respondFriendRequest(ALICE, db.friendships[0].id, true);
    const cmp = await repo.getCompareData(ALICE, id, forkId);
    expect(cmp?.canSetPreferred).toBe(true);
    expect(cmp?.branch.cardCount).toBe(1);
    expect(await repo.getCompareData(ALICE, forkId, id)).toBeNull();

    await rejectsWith(repo.setPreferredBranch(BOB, id, forkId), "Only the source deck owner");
    await repo.setPreferredBranch(ALICE, id, forkId);
    deck = await repo.getDeck(ALICE, id);
    expect(deck?.preferredBranchId).toBe(forkId);
    // L1: the preferred branch is friends-only, so a signed-out viewer sees
    // neither it nor its id (the page then has no Compare link to 404).
    deck = await repo.getDeck(null, id);
    expect(deck?.preferredBranchId).toBeNull();
    expect(deck?.branches).toEqual([]);
  });

  it("visibility and fork permissions are enforced", async () => {
    const id = await repo.createDeck(ALICE, {
      name: "Secret", format: "modern", notes: "", visibility: "friends", allowForks: false,
    });
    expect(await repo.getDeck(BOB, id)).toBeNull();
    expect(await repo.getDeck(null, id)).toBeNull();
    await rejectsWith(repo.forkDeck(BOB, id), "You are not allowed to fork this deck");
    expect(await repo.getDeckPermissions(BOB, id)).toEqual({ canEdit: false, canFork: false, canComment: false });
    expect(await repo.getDeckPermissions(ALICE, id)).toEqual({ canEdit: true, canFork: true, canComment: true });
    expect(await repo.listDecks(null, "public")).toEqual([]);
  });

  it("delete keeps forks (source pointer cleared) and removes comments", async () => {
    const id = await repo.createDeck(ALICE, {
      name: "A", format: "modern", notes: "", visibility: "public", allowForks: true,
    });
    const forkId = await repo.forkDeck(BOB, id);
    await repo.addComment(BOB, id, "hi");
    await rejectsWith(repo.deleteDeck(BOB, id), "You cannot delete this deck");
    await repo.deleteDeck(ALICE, id);
    expect(db.comments).toEqual([]);
    expect(db.decks.find((d) => d.id === forkId)?.forkedFromId).toBeNull();
  });

  it("drops non-Scryfall image URLs", async () => {
    const id = await repo.createDeck(ALICE, {
      name: "A", format: "modern", notes: "", visibility: "private", allowForks: true,
    });
    await repo.addCard(ALICE, id, { ...card, imageUri: "https://evil.example/pixel.png" });
    expect(db.deckCards[0].imageUri).toBeNull();
  });
});

describe("local adapter: comments and favorites", () => {
  it("comments need deck access; authors carry no email", async () => {
    const id = await repo.createDeck(ALICE, {
      name: "A", format: "modern", notes: "", visibility: "private", allowForks: true,
    });
    await rejectsWith(repo.addComment(BOB, id, "hi"), "You cannot comment on this deck");
    await repo.addComment(ALICE, id, "mine");
    const comments = await repo.listComments(ALICE, id);
    expect(comments[0].author).toEqual({ id: ALICE, username: "alice_u", displayName: "ALICE_U" });
    expect(await repo.listComments(BOB, id)).toEqual([]);
    expect(JSON.stringify(comments)).not.toMatch(/email|corp\.example/);
  });

  it("favorites are per user and de-duplicated", async () => {
    const fav = { scryfallId: "s1", cardName: "Sol Ring", imageUri: null, manaCost: null, typeLine: null };
    await repo.addFavorite(ALICE, fav);
    await repo.addFavorite(ALICE, fav);
    expect(await repo.listFavorites(ALICE)).toHaveLength(1);
    expect(await repo.listFavorites(BOB)).toHaveLength(0);
    const [f] = await repo.listFavorites(ALICE);
    await repo.removeFavorite(BOB, f.id);
    expect(await repo.listFavorites(ALICE)).toHaveLength(1);
    await repo.removeFavorite(ALICE, f.id);
    expect(await repo.listFavorites(ALICE)).toHaveLength(0);
  });
});

describe("local adapter: friend search is exact", () => {
  it("matches the whole username, case-insensitively, 0 or 1 result, never yourself", async () => {
    expect(await repo.findProfile(ALICE, "BOB_U")).toEqual([
      { id: BOB, username: "bob_u", displayName: "BOB_U", avatarUrl: null },
    ]);
    expect(await repo.findProfile(ALICE, BOB)).toEqual([]);
    expect(await repo.findProfile(ALICE, "b")).toEqual([]);
    expect(await repo.findProfile(ALICE, "BOB")).toEqual([]); // display name isn't searched
    expect(await repo.findProfile(ALICE, "alice_u")).toEqual([]);
    expect(await repo.findProfile(ALICE, "%_u")).toEqual([]);
  });
});

describe("local adapter: friend requests (P2)", () => {
  it("request -> decline -> no re-send; the old row stays declined", async () => {
    await repo.sendFriendRequest(ALICE, BOB);
    const [f] = db.friendships;
    await rejectsWith(repo.respondFriendRequest(ALICE, f.id, true), FRIEND_MESSAGES.requestNotFound);
    await repo.respondFriendRequest(BOB, f.id, false);

    await rejectsWith(repo.sendFriendRequest(ALICE, BOB), FRIEND_MESSAGES.declined);
    expect(db.friendships).toEqual([{ ...f, status: "declined" }]);

    // The requester can't clear it either; the addressee can't answer twice.
    await rejectsWith(repo.removeFriendship(ALICE, f.id), FRIEND_MESSAGES.cannotRemove);
    await rejectsWith(repo.respondFriendRequest(BOB, f.id, true), FRIEND_MESSAGES.requestNotFound);
    expect((await repo.getFriendsData(ALICE)).outgoing).toEqual([]);
  });

  it("the user who declined can send their own request (fresh pending row)", async () => {
    await repo.sendFriendRequest(ALICE, BOB);
    await repo.respondFriendRequest(BOB, db.friendships[0].id, false);
    await repo.sendFriendRequest(BOB, ALICE);
    expect(db.friendships).toHaveLength(1);
    expect(db.friendships[0]).toMatchObject({ requesterId: BOB, addresseeId: ALICE, status: "pending" });
  });

  it("accept, then either side unfriends", async () => {
    await repo.sendFriendRequest(ALICE, BOB);
    await rejectsWith(repo.sendFriendRequest(ALICE, BOB), FRIEND_MESSAGES.alreadySent);
    await rejectsWith(repo.sendFriendRequest(BOB, ALICE), FRIEND_MESSAGES.theyAsked);
    const id = db.friendships[0].id;
    await repo.respondFriendRequest(BOB, id, true);
    await rejectsWith(repo.sendFriendRequest(BOB, ALICE), FRIEND_MESSAGES.alreadyFriends);

    const data = await repo.getFriendsData(ALICE);
    expect(data.friends.map((r) => r.profile.username)).toEqual(["bob_u"]);
    expect(JSON.stringify(data)).not.toMatch(/email|corp\.example|secret bio/);

    await repo.removeFriendship(ALICE, id);
    expect(db.friendships).toEqual([]);
  });

  it("requester cancels a pending request; strangers can't touch it", async () => {
    await repo.sendFriendRequest(ALICE, BOB);
    const id = db.friendships[0].id;
    await rejectsWith(repo.removeFriendship(CAROL, id), FRIEND_MESSAGES.requestNotFound);
    await rejectsWith(repo.respondFriendRequest(CAROL, id, true), FRIEND_MESSAGES.requestNotFound);
    await repo.removeFriendship(ALICE, id);
    expect(db.friendships).toEqual([]);
  });

  it("addressee may clear a declined row", async () => {
    await repo.sendFriendRequest(ALICE, BOB);
    const id = db.friendships[0].id;
    await repo.respondFriendRequest(BOB, id, false);
    await repo.removeFriendship(BOB, id);
    expect(db.friendships).toEqual([]);
  });

  it("self and unknown users are refused", async () => {
    await rejectsWith(repo.sendFriendRequest(ALICE, ALICE), FRIEND_MESSAGES.self);
    await rejectsWith(repo.sendFriendRequest(ALICE, NOBODY), FRIEND_MESSAGES.notFound);
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
    as(ALICE);
    expect(await actions.sendFriendRequestAction(BOB)).toEqual({ success: true });
    as(BOB);
    const incoming = (await repo.getFriendsData(BOB)).incoming;
    expect(await actions.respondFriendRequestAction(incoming[0].friendship.id, false)).toEqual({ success: true });
    as(ALICE);
    expect(await actions.sendFriendRequestAction(BOB)).toEqual({ error: FRIEND_MESSAGES.declined });
    expect(await actions.findProfileAction("bob_u")).toHaveLength(1);
    expect(await actions.findProfileAction("bo")).toEqual([]);
  });
});

describe("local adapter: branch visibility (review M1, L1)", () => {
  const SECRET = /PRIVATE-NOTES|FRIENDS-NOTES|Private branch|Friends branch/;

  async function setup() {
    const source = await repo.createDeck(ALICE, {
      name: "Source", format: "modern", notes: "public notes", visibility: "public", allowForks: true,
    });
    const privateBranch = await repo.forkDeck(BOB, source);
    await repo.updateDeck(BOB, privateBranch, {
      name: "Private branch", format: "modern", notes: "BEN-PRIVATE-NOTES", visibility: "private", allowForks: false,
    });
    const friendsBranch = await repo.forkDeck(BOB, source);
    await repo.updateDeck(BOB, friendsBranch, {
      name: "Friends branch", format: "modern", notes: "BEN-FRIENDS-NOTES", visibility: "friends", allowForks: false,
    });
    const publicBranch = await repo.forkDeck(CAROL, source);
    await repo.updateDeck(CAROL, publicBranch, {
      name: "Public branch", format: "modern", notes: "carol notes", visibility: "public", allowForks: true,
    });
    return { source, privateBranch, friendsBranch, publicBranch };
  }

  for (const [label, viewer] of [["signed out", null], ["a non-friend", ALICE]] as const) {
    it(`${label} can't see private or friends-only branch names or notes`, async () => {
      const { source, publicBranch, privateBranch, friendsBranch } = await setup();
      const deck = await repo.getDeck(viewer, source);
      expect(deck?.branches?.map((b) => b.id)).toEqual([publicBranch]);
      expect(deck?.forkCount).toBe(1);
      expect(JSON.stringify(deck)).not.toMatch(SECRET);

      const listed = await repo.listDecks(viewer, "public");
      expect(JSON.stringify(listed)).not.toMatch(SECRET);

      const cmp = await repo.getCompareData(viewer, source, publicBranch);
      expect(cmp).not.toBeNull();
      expect(JSON.stringify(cmp)).not.toMatch(SECRET);
      expect(await repo.getCompareData(viewer, source, privateBranch)).toBeNull();
      expect(await repo.getCompareData(viewer, source, friendsBranch)).toBeNull();
    });
  }

  it("a friend sees the friends-only branch but not the private one; the owner sees both", async () => {
    const { source, publicBranch, friendsBranch, privateBranch } = await setup();
    await repo.sendFriendRequest(BOB, CAROL);
    await repo.respondFriendRequest(CAROL, db.friendships[0].id, true);
    const asCarol = await repo.getDeck(CAROL, source);
    expect(asCarol?.branches?.map((b) => b.id).sort()).toEqual([friendsBranch, publicBranch].sort());
    expect(JSON.stringify(asCarol)).not.toMatch(/PRIVATE-NOTES|Private branch/);
    const asBob = await repo.getDeck(BOB, source);
    expect(asBob?.branches?.map((b) => b.id).sort()).toEqual([privateBranch, friendsBranch, publicBranch].sort());
  });

  it("the source deck is hidden from a branch when the viewer can't see it", async () => {
    const { source, publicBranch } = await setup();
    expect((await repo.getDeck(null, publicBranch))?.sourceDeck?.id).toBe(source);
    await repo.updateDeck(ALICE, source, {
      name: "Source", format: "modern", notes: "now private", visibility: "private", allowForks: true,
    });
    const branch = await repo.getDeck(null, publicBranch);
    expect(branch?.forkedFromId).toBe(source);
    expect(branch?.sourceDeck).toBeNull();
    expect(JSON.stringify(branch)).not.toMatch(/now private/);
  });

  it("setPreferredBranch refuses a branch the owner can't see (same message as a non-branch)", async () => {
    const { source, privateBranch, friendsBranch, publicBranch } = await setup();
    await rejectsWith(repo.setPreferredBranch(ALICE, source, privateBranch), "Branch does not belong to this deck");
    await rejectsWith(repo.setPreferredBranch(ALICE, source, friendsBranch), "Branch does not belong to this deck");
    await rejectsWith(repo.setPreferredBranch(ALICE, source, NOBODY), "Branch does not belong to this deck");
    await repo.setPreferredBranch(ALICE, source, publicBranch);
    expect(db.decks.find((d) => d.id === source)?.preferredBranchId).toBe(publicBranch);
  });

  it("L1: a preferred branch that later becomes hidden is reported as null", async () => {
    const { source, publicBranch } = await setup();
    await repo.setPreferredBranch(ALICE, source, publicBranch);
    await repo.updateDeck(CAROL, publicBranch, {
      name: "Public branch", format: "modern", notes: "", visibility: "private", allowForks: true,
    });
    for (const viewer of [null, ALICE]) {
      const deck = await repo.getDeck(viewer, source);
      expect(deck?.preferredBranchId).toBeNull();
      expect(deck?.branches?.some((b) => b.id === publicBranch)).toBe(false);
    }
    expect((await repo.getDeck(CAROL, source))?.preferredBranchId).toBe(publicBranch);
  });
});

describe("local adapter: fork rules match fork_deck() (review F4)", () => {
  // Mirrors supabase/tests/review_fixes.sql "F4": ann owns a public and a
  // friends-only deck; ben is ann's friend; cat is ben's friend, not ann's.
  it("forks of non-public decks start private and locked; public forks are friends-only and forkable", async () => {
    const [ann, ben, cat] = [ALICE, BOB, CAROL];
    const befriend = async (a: string, b: string) => {
      await repo.sendFriendRequest(a, b);
      const f = db.friendships.find((x) => x.requesterId === a && x.addresseeId === b)!;
      await repo.respondFriendRequest(b, f.id, true);
    };
    await befriend(ann, ben);
    await befriend(ben, cat);
    const pub = await repo.createDeck(ann, {
      name: "Public", format: "modern", notes: "", visibility: "public", allowForks: true,
    });
    const friends = await repo.createDeck(ann, {
      name: "Friends", format: "modern", notes: "", visibility: "friends", allowForks: true,
    });

    const fFriends = await repo.forkDeck(ben, friends);
    const fPublic = await repo.forkDeck(ben, pub);
    const deck = (id: string) => db.decks.find((d) => d.id === id)!;
    expect(`${deck(fFriends).visibility}/${deck(fFriends).allowForks}`).toBe("private/false");
    expect(`${deck(fPublic).visibility}/${deck(fPublic).allowForks}`).toBe("friends/true");
    // cat (ben's friend) can't see the fork of ann's friends-only deck...
    expect(await repo.getDeck(cat, fFriends)).toBeNull();
    // ...but can see the friends-only fork of the public deck.
    expect(await repo.getDeck(cat, fPublic)).not.toBeNull();
    await rejectsWith(repo.forkDeck(cat, fFriends), "You are not allowed to fork this deck");

    // The owner can fork their own private deck; the fork is private and locked.
    const priv = await repo.createDeck(ann, {
      name: "Private", format: "modern", notes: "", visibility: "private", allowForks: true,
    });
    const fPriv = await repo.forkDeck(ann, priv);
    expect(`${deck(fPriv).visibility}/${deck(fPriv).allowForks}`).toBe("private/false");
  });
});
