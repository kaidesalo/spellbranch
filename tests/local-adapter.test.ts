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
// findProfileAction reads the client IP from the request headers (review M1).
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
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
  manaCost: "{1}", typeLine: "Artifact", colors: [], colorIdentity: [], oracleText: null, quantity: 1,
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
    expect(await repo.getDeckPermissions(BOB, id)).toEqual({ canEdit: false, canFork: false, canCopy: false, canComment: false });
    expect(await repo.getDeckPermissions(ALICE, id)).toEqual({ canEdit: true, canFork: true, canCopy: true, canComment: true });
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
    expect((await actions.findProfileAction("bob_u")).profiles).toHaveLength(1);
    expect(await actions.findProfileAction("bo")).toEqual({ profiles: [] });
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
    // The fork page still lists visible siblings, and not the hidden source.
    expect(branch?.sourceBranches?.map((b) => b.id)).toEqual([publicBranch]);
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

  it("a fork page lists the source and only the siblings that viewer can see", async () => {
    const { source, publicBranch, privateBranch, friendsBranch } = await setup();
    const signedOut = await repo.getDeck(null, publicBranch);
    expect(signedOut?.sourceDeck?.id).toBe(source);
    expect(signedOut?.sourceBranches?.map((b) => b.id)).toEqual([publicBranch]);

    await repo.sendFriendRequest(BOB, CAROL);
    await repo.respondFriendRequest(CAROL, db.friendships[0].id, true);
    const asCarol = await repo.getDeck(CAROL, publicBranch);
    expect(asCarol?.sourceBranches?.map((b) => b.id).sort()).toEqual([friendsBranch, publicBranch].sort());
    expect(JSON.stringify(asCarol?.sourceBranches)).not.toMatch(/Private branch|BEN-PRIVATE-NOTES/);

    const asBob = await repo.getDeck(BOB, privateBranch);
    expect(asBob?.sourceDeck?.owner?.username).toBe("alice_u");
    expect(asBob?.sourceBranches?.map((b) => b.id).sort()).toEqual(
      [privateBranch, friendsBranch, publicBranch].sort(),
    );

    // Alice owns the source but is not Bob's friend, so private and
    // friends-only branches stay off her fork page too.
    const asAlice = await repo.getDeck(ALICE, publicBranch);
    expect(asAlice?.sourceBranches?.map((b) => b.id)).toEqual([publicBranch]);
  });
});

describe("local adapter: fork names", () => {
  it("uses the given name and still applies the F4 visibility rule", async () => {
    const pub = await repo.createDeck(ALICE, {
      name: "Public", format: "modern", notes: "keep", visibility: "public", allowForks: true,
    });
    const friends = await repo.createDeck(ALICE, {
      name: "Friends", format: "modern", notes: "", visibility: "friends", allowForks: true,
    });
    const named = await repo.forkDeck(BOB, pub, "  My branch  ");
    const locked = await repo.forkDeck(ALICE, friends, "Owner branch");
    const namedDeck = db.decks.find((d) => d.id === named)!;
    const lockedDeck = db.decks.find((d) => d.id === locked)!;
    expect(namedDeck.name).toBe("My branch");
    expect(`${namedDeck.visibility}/${namedDeck.allowForks}`).toBe("friends/true");
    expect(namedDeck.notes).toBe("keep");
    expect(`${lockedDeck.visibility}/${lockedDeck.allowForks}`).toBe("private/false");
    expect(lockedDeck.name).toBe("Owner branch");

    const before = db.decks.length;
    await rejectsWith(repo.forkDeck(BOB, pub, "   "), "Deck name is required");
    await rejectsWith(repo.forkDeck(BOB, pub, "n".repeat(81)), "Deck name must be at most 80 characters");
    expect(db.decks).toHaveLength(before);
    expect(await repo.forkDeck(BOB, pub, "n".repeat(80))).toBeTruthy();
  });

  it("a bad name does not reveal a deck the caller cannot fork", async () => {
    const secret = await repo.createDeck(ALICE, {
      name: "Secret", format: "modern", notes: "", visibility: "private", allowForks: false,
    });
    await rejectsWith(repo.forkDeck(BOB, secret, "   "), "You are not allowed to fork this deck");
    expect(db.decks).toHaveLength(1);
  });

  it("stores the chosen name on the branch, and every viewer who can see it reads that name", async () => {
    // The name is decks.name (one column), not a note kept for the forker.
    // Visibility still decides who may read the row at all.
    const befriend = async (a: string, b: string) => {
      await repo.sendFriendRequest(a, b);
      const f = db.friendships.find((x) => x.requesterId === a && x.addresseeId === b)!;
      await repo.respondFriendRequest(b, f.id, true);
    };
    await befriend(ALICE, BOB);
    await befriend(BOB, CAROL);

    const source = await repo.createDeck(ALICE, {
      name: "Live and Burn", format: "modern", notes: "shadow test", visibility: "public", allowForks: true,
    });
    const branch = await repo.forkDeck(BOB, source, "  Shadow test  ");
    expect(db.decks.find((d) => d.id === branch)?.name).toBe("Shadow test");

    const asAliceOnSource = await repo.getDeck(ALICE, source);
    expect(asAliceOnSource?.branches?.map((b) => [b.id, b.name])).toEqual([[branch, "Shadow test"]]);
    const asAliceOnBranch = await repo.getDeck(ALICE, branch);
    expect(asAliceOnBranch?.name).toBe("Shadow test");
    expect(asAliceOnBranch?.sourceDeck?.name).toBe("Live and Burn");
    expect((await repo.listFriendBranchesOnMyDecks(ALICE)).map((d) => d.name)).toEqual(["Shadow test"]);
    expect((await repo.getCompareData(ALICE, source, branch))?.branch.name).toBe("Shadow test");

    // Bob's other friend sees the same stored name. A signed-out viewer does not:
    // a fork of a public deck is friends-only.
    const asCarol = await repo.getDeck(CAROL, branch);
    expect(asCarol?.name).toBe("Shadow test");
    expect(asCarol?.sourceDeck?.name).toBe("Live and Burn");
    expect(asCarol?.sourceBranches?.map((b) => b.name)).toEqual(["Shadow test"]);
    expect(await repo.getDeck(null, branch)).toBeNull();

    // Forking the named branch stacks on the original deck, not on the branch.
    // The new row starts private (the branch is friends-only). Carol can see
    // it. Bob is not the root owner, so the source-owner exception does not
    // show him Carol's private fork. Alice is not Carol's friend, so the
    // root's branch list stays Bob's branch only.
    const nested = await repo.forkDeck(CAROL, branch, "Carol take");
    expect(db.decks.find((d) => d.id === nested)?.forkedFromId).toBe(source);
    const asCarolOnNested = await repo.getDeck(CAROL, nested);
    expect(asCarolOnNested?.name).toBe("Carol take");
    expect(asCarolOnNested?.sourceDeck?.name).toBe("Live and Burn");
    expect(asCarolOnNested?.sourceBranches?.map((b) => b.name).sort()).toEqual(
      ["Carol take", "Shadow test"].sort(),
    );
    expect((await repo.getDeck(BOB, branch))?.branches ?? []).toEqual([]);
    expect(await repo.getDeck(BOB, nested)).toBeNull();
    expect(await repo.getDeck(ALICE, nested)).toBeNull();
    expect((await repo.getDeck(ALICE, source))?.branches?.map((b) => b.name)).toEqual(["Shadow test"]);
    expect(JSON.stringify(await repo.getDeck(ALICE, source))).not.toMatch(/Carol take/);
    expect(await repo.getDeck(null, nested)).toBeNull();

    await repo.updateDeck(BOB, branch, {
      name: "Shadow test", format: "modern", notes: "", visibility: "public", allowForks: true,
    });
    expect((await repo.getDeck(null, branch))?.name).toBe("Shadow test");
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

describe("local adapter: source owner sees friend forks (009)", () => {
  // Mirrors supabase/tests/friend_branch_visibility.sql. Ann owns the source,
  // Ben is her friend, Cat is Ben's friend (and later a non-friend forker).
  const ann = ALICE;
  const ben = BOB;
  const cat = CAROL;

  async function befriend(a: string, b: string) {
    await repo.sendFriendRequest(a, b);
    const f = db.friendships.find((x) => x.requesterId === a && x.addresseeId === b)!;
    await repo.respondFriendRequest(b, f.id, true);
    return f.id;
  }

  it("shows a friend's private fork to the source owner only, and only while they are friends", async () => {
    await befriend(ann, ben);
    await befriend(ben, cat);
    const friends = await repo.createDeck(ann, {
      name: "Ann friends", format: "modern", notes: "secret", visibility: "friends", allowForks: true,
    });
    await repo.addCard(ann, friends, card);
    const pub = await repo.createDeck(ann, {
      name: "Ann public", format: "modern", notes: "", visibility: "public", allowForks: true,
    });

    const benFork = await repo.forkDeck(ben, friends);
    const stored = (id: string) => db.decks.find((d) => d.id === id)!;
    expect(`${stored(benFork).visibility}/${stored(benFork).allowForks}`).toBe("private/false");

    const seen = await repo.getDeck(ann, benFork);
    expect(seen).toMatchObject({ name: "Ann friends (branch)", visibility: "private", cardCount: 1 });
    expect(seen?.sourceDeck?.id).toBe(friends);
    expect(seen?.sourceBranches?.map((b) => [b.id, b.owner?.username])).toEqual([[benFork, "bob_u"]]);
    expect((await repo.getDeckPermissions(ann, benFork)).canEdit).toBe(false);
    const onSource = await repo.getDeck(ann, friends);
    expect(onSource?.branches?.map((b) => [b.id, b.owner?.username])).toEqual([[benFork, "bob_u"]]);
    expect(await repo.getCompareData(ann, friends, benFork)).not.toBeNull();
    await repo.setPreferredBranch(ann, friends, benFork);
    expect((await repo.getDeck(ann, friends))?.preferredBranchId).toBe(benFork);

    expect(await repo.getDeck(cat, benFork)).toBeNull();
    expect(await repo.getCompareData(cat, friends, benFork)).toBeNull();

    await rejectsWith(
      repo.updateDeck(ann, benFork, {
        name: "nope", format: "modern", notes: "", visibility: "public", allowForks: true,
      }),
      "You cannot edit this deck",
    );
    await rejectsWith(repo.deleteDeck(ann, benFork), "You cannot delete this deck");
    await rejectsWith(repo.addCard(ann, benFork, card), "You cannot edit this deck");
    const copiedId = (await repo.getDeck(ben, benFork))!.cards![0].id;
    await rejectsWith(repo.setCardQuantity(ann, benFork, copiedId, 4), "You cannot edit this deck");
    await rejectsWith(repo.forkDeck(ann, benFork), "You are not allowed to fork this deck");
    expect(stored(benFork).name).toBe("Ann friends (branch)");

    const strangerFork = await repo.forkDeck(cat, pub);
    expect(`${stored(strangerFork).visibility}/${stored(strangerFork).allowForks}`).toBe("friends/true");
    expect(await repo.getDeck(ann, strangerFork)).toBeNull();
    expect((await repo.getDeck(ann, pub))?.branches ?? []).toEqual([]);
    await rejectsWith(
      repo.setPreferredBranch(ann, pub, strangerFork),
      "Branch does not belong to this deck",
    );

    const listed = await repo.listFriendBranchesOnMyDecks(ann);
    expect(listed.map((d) => d.id)).toEqual([benFork]);
    expect(listed[0].owner?.username).toBe("bob_u");
    expect(listed[0].sourceDeck?.name).toBe("Ann friends");
    expect((await repo.listMyBranches(ann)).map((d) => d.id)).not.toContain(benFork);
    expect((await repo.listMyBranches(ben)).map((d) => d.id)).toContain(benFork);
    expect(await repo.listFriendBranchesOnMyDecks(ben)).toEqual([]);

    const withCat = await befriend(ann, cat);
    expect(await repo.getDeck(ann, strangerFork)).not.toBeNull();
    await repo.updateDeck(cat, strangerFork, {
      name: "Cat private", format: "modern", notes: "cat-notes", visibility: "private", allowForks: false,
    });
    expect((await repo.getDeck(ann, strangerFork))?.visibility).toBe("private");
    expect((await repo.getDeck(ann, pub))?.branches?.map((b) => [b.id, b.owner?.username])).toEqual([
      [strangerFork, "carol_u"],
    ]);
    expect((await repo.listFriendBranchesOnMyDecks(ann)).map((d) => d.id).sort()).toEqual(
      [benFork, strangerFork].sort(),
    );

    await repo.removeFriendship(ann, withCat);
    expect(await repo.getDeck(ann, strangerFork)).toBeNull();
    expect((await repo.getDeck(ann, pub))?.branches ?? []).toEqual([]);
    expect(await repo.getDeck(cat, benFork)).toBeNull();
    expect((await repo.listFriendBranchesOnMyDecks(ann)).map((d) => d.id)).toEqual([benFork]);
  });
});

describe("local adapter: forks stack on the root, copies stay independent", () => {
  async function befriend(a: string, b: string) {
    await repo.sendFriendRequest(a, b);
    const f = db.friendships.find((x) => x.requesterId === a && x.addresseeId === b)!;
    await repo.respondFriendRequest(b, f.id, true);
  }

  const deckInput = (name: string, visibility: "public" | "friends" | "private" = "public") => ({
    name, format: "modern" as const, notes: `${name} notes`, visibility, allowForks: true,
  });

  it("a cross-user fork and a fork of that fork both belong to the original deck", async () => {
    await befriend(ALICE, BOB);
    await befriend(ALICE, CAROL);
    await befriend(BOB, CAROL);
    const root = await repo.createDeck(ALICE, deckInput("Live and Burn"));
    await repo.addCard(ALICE, root, card);

    const bobBranch = await repo.forkDeck(BOB, root, "Bob line");
    expect(db.decks.find((d) => d.id === bobBranch)).toMatchObject({
      forkedFromId: root,
      copiedFromId: null,
      ownerId: BOB,
      visibility: "friends",
    });

    const carolBranch = await repo.forkDeck(CAROL, bobBranch, "Carol take");
    expect(db.decks.find((d) => d.id === carolBranch)).toMatchObject({
      forkedFromId: root,
      copiedFromId: null,
      ownerId: CAROL,
      visibility: "private",
    });
    // Not a child of Bob's branch, and not a new tree.
    expect(db.decks.find((d) => d.id === bobBranch)?.forkedFromId).toBe(root);
    expect((await repo.getDeck(BOB, bobBranch))?.branches ?? []).toEqual([]);

    const asAlice = await repo.getDeck(ALICE, root);
    expect(asAlice?.branches?.map((b) => [b.name, b.owner?.username]).sort()).toEqual([
      ["Bob line", "bob_u"],
      ["Carol take", "carol_u"],
    ].sort());

    // Viewers who can see both branches get the same full list on the root
    // and on every branch. Bob cannot see Carol's private fork (he is not
    // the root owner), so his menu is only the branch he can see.
    const full = [bobBranch, carolBranch].sort();
    for (const viewer of [ALICE, CAROL]) {
      expect((await repo.getDeck(viewer, root))?.branches?.map((b) => b.id).sort()).toEqual(full);
      for (const id of [bobBranch, carolBranch]) {
        const page = await repo.getDeck(viewer, id);
        expect(page?.sourceDeck?.id).toBe(root);
        expect(page?.sourceBranches?.map((b) => b.id).sort()).toEqual(full);
      }
    }
    expect((await repo.getDeck(BOB, bobBranch))?.sourceBranches?.map((b) => b.id)).toEqual([bobBranch]);
    expect(await repo.getDeck(BOB, carolBranch)).toBeNull();

    const later = await repo.forkDeck(ALICE, bobBranch, "Alice again");
    expect(db.decks.find((d) => d.id === later)?.forkedFromId).toBe(root);
    expect((await repo.getDeck(ALICE, root))?.branches?.map((b) => b.id).sort()).toEqual(
      [bobBranch, carolBranch, later].sort(),
    );
  });

  it("a copy is a new deck and later forks of either side stay apart", async () => {
    await befriend(ALICE, BOB);
    const root = await repo.createDeck(ALICE, deckInput("Live and Burn"));
    await repo.addCard(ALICE, root, card);
    const branch = await repo.forkDeck(BOB, root, "Bob line");

    const copy = await repo.copyDeck(BOB, branch, "  Burn copy  ");
    const stored = db.decks.find((d) => d.id === copy)!;
    expect(stored).toMatchObject({
      name: "Burn copy",
      ownerId: BOB,
      forkedFromId: null,
      copiedFromId: branch,
      visibility: "private",
      allowForks: false,
    });
    expect(stored.id).not.toBe(branch);
    expect((await repo.getDeck(ALICE, root))?.branches?.map((b) => b.id)).toEqual([branch]);
    expect(JSON.stringify(await repo.getDeck(ALICE, root))).not.toMatch(/Burn copy/);

    const asBob = await repo.getDeck(BOB, copy);
    expect(asBob?.branches ?? []).toEqual([]);
    expect(asBob?.sourceBranches).toBeUndefined();
    expect(asBob?.copiedFromDeck?.id).toBe(branch);
    expect(asBob?.copiedFromId).toBe(branch);
    expect(asBob?.cardCount).toBe(1);

    const copyFork = await repo.forkDeck(BOB, copy, "Copy branch");
    expect(db.decks.find((d) => d.id === copyFork)?.forkedFromId).toBe(copy);
    expect((await repo.getDeck(BOB, copy))?.branches?.map((b) => b.id)).toEqual([copyFork]);
    expect((await repo.getDeck(ALICE, root))?.branches?.map((b) => b.id)).toEqual([branch]);
    expect((await repo.getDeck(BOB, copy))?.branches?.map((b) => b.id)).not.toContain(branch);

    const rootFork = await repo.forkDeck(ALICE, root, "Alice line");
    expect((await repo.getDeck(BOB, copy))?.branches?.map((b) => b.id)).toEqual([copyFork]);
    expect(JSON.stringify(await repo.getDeck(BOB, copy))).not.toMatch(/Alice line/);
    expect((await repo.getDeck(ALICE, root))?.branches?.map((b) => b.id).sort()).toEqual(
      [branch, rootFork].sort(),
    );
  });

  it("compares a copy to its source, and drops the link when the source is hidden or deleted", async () => {
    await befriend(ALICE, BOB);
    const root = await repo.createDeck(ALICE, deckInput("Source Secret"));
    await repo.addCard(ALICE, root, card);
    const copy = await repo.copyDeck(BOB, root, "My copy");

    const compared = await repo.getCompareData(BOB, root, copy);
    expect(compared?.copy).toBe(true);
    expect(compared?.canSetPreferred).toBe(false);
    expect(compared?.source.name).toBe("Source Secret");
    expect(compared?.branch.name).toBe("My copy");
    expect(compared?.branch.cardCount).toBe(1);
    await rejectsWith(
      repo.setPreferredBranch(ALICE, root, copy),
      "Branch does not belong to this deck",
    );
    // A copy is not a branch, and a branch is not a copy of some other deck.
    expect(await repo.getCompareData(BOB, copy, root)).toBeNull();
    const branch = await repo.forkDeck(BOB, root, "Bob line");
    expect((await repo.getCompareData(ALICE, root, branch))?.copy).toBe(false);
    expect(await repo.getCompareData(BOB, root, branch)).not.toBeNull();

    await repo.updateDeck(ALICE, root, {
      name: "Hidden Title", format: "modern", notes: "SOURCE-ONLY-NOTE", visibility: "private", allowForks: true,
    });
    const hidden = await repo.getDeck(BOB, copy);
    expect(hidden?.copySourceUnavailable).toBe(true);
    expect(hidden?.copiedFromDeck ?? null).toBeNull();
    expect(hidden?.copiedFromId).toBeNull();
    const dumped = JSON.stringify(hidden);
    expect(dumped).not.toContain(root);
    expect(dumped).not.toContain("SOURCE-ONLY-NOTE");
    expect(dumped).not.toContain("Hidden Title");
    expect(await repo.getCompareData(BOB, root, copy)).toBeNull();

    await repo.deleteDeck(ALICE, root);
    expect(db.decks.find((d) => d.id === copy)?.copiedFromId ?? null).toBeNull();
    const gone = await repo.getDeck(BOB, copy);
    expect(gone?.copySourceUnavailable).toBe(false);
    expect(gone?.copiedFromId).toBeNull();
    expect(gone?.name).toBe("My copy");
  });

  it("refuses a copy of a deck the caller cannot view, before checking the name", async () => {
    const secret = await repo.createDeck(ALICE, {
      name: "Secret", format: "modern", notes: "", visibility: "private", allowForks: false,
    });
    await rejectsWith(repo.copyDeck(BOB, secret, "   "), "You are not allowed to copy this deck");
    expect(db.decks).toHaveLength(1);
    const own = await repo.copyDeck(ALICE, secret);
    expect(db.decks.find((d) => d.id === own)?.name).toBe("Secret (copy)");
  });

  it("refuses a fork when the original deck has forks turned off, and still allows a copy", async () => {
    await befriend(ALICE, BOB);
    await befriend(BOB, CAROL);
    const root = await repo.createDeck(ALICE, deckInput("Live and Burn"));
    const branch = await repo.forkDeck(BOB, root, "Bob line");
    await repo.updateDeck(ALICE, root, {
      name: "Live and Burn", format: "modern", notes: "", visibility: "public", allowForks: false,
    });

    await rejectsWith(repo.forkDeck(CAROL, branch, "Nope"), "The original deck does not allow forks");
    expect(db.decks.find((d) => d.name === "Nope")).toBeUndefined();
    const perms = await repo.getDeckPermissions(CAROL, branch);
    expect(perms.canFork).toBe(false);
    expect(perms.canCopy).toBe(true);
    const copy = await repo.copyDeck(CAROL, branch, "Carol copy");
    expect(db.decks.find((d) => d.id === copy)?.forkedFromId).toBeNull();
    expect(db.decks.find((d) => d.id === copy)?.copiedFromId).toBe(branch);

    // Alice owns the original deck, so she can still fork the branch.
    const again = await repo.forkDeck(ALICE, branch, "Alice again");
    expect(db.decks.find((d) => d.id === again)?.forkedFromId).toBe(root);
  });

  it("refuses a fork when the original deck is private and not visible, without naming that deck", async () => {
    await befriend(ALICE, BOB);
    await befriend(BOB, CAROL);
    const root = await repo.createDeck(ALICE, deckInput("Hidden root"));
    const branch = await repo.forkDeck(BOB, root, "Bob line");
    await repo.updateDeck(ALICE, root, {
      name: "Hidden root", format: "modern", notes: "ROOT-SECRET", visibility: "private", allowForks: true,
    });

    await rejectsWith(repo.forkDeck(CAROL, branch), "You are not allowed to fork this deck");
    expect((await repo.getDeckPermissions(CAROL, branch)).canFork).toBe(false);
    expect((await repo.getDeck(CAROL, branch))?.sourceDeck ?? null).toBeNull();
  });

  it("shortens an 80-character source name for the copy default", async () => {
    const root = await repo.createDeck(ALICE, {
      name: "n".repeat(80), format: "modern", notes: "", visibility: "public", allowForks: true,
    });
    const copy = await repo.copyDeck(ALICE, root);
    const stored = db.decks.find((d) => d.id === copy)!;
    expect(stored.name).toHaveLength(80);
    expect(stored.name.endsWith(" (copy)")).toBe(true);
  });
});
