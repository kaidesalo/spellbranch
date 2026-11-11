import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import type { Comment, Deck, Friendship } from "@/lib/types";

// Local adapter: profile pages follow canViewProfile / canViewDeck, the same
// rules as the Supabase policies (002 profiles RLS, can_view_deck including 009).

let db: DataStore;
vi.mock("@/lib/data/store", () => ({
  readStore: async () => structuredClone(db),
  updateStore: async () => undefined,
}));

const { localRepository: repo } = await import("@/lib/data/local");

const T = "2026-10-20T14:00:00.000Z";
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const CAROL = "a0000000-0000-4000-8000-000000000003";
const DAVE = "a0000000-0000-4000-8000-000000000004";
const FRANK = "a0000000-0000-4000-8000-000000000005";
const GINA = "a0000000-0000-4000-8000-000000000006";

const user = (id: string, username: string, bio: string): LocalUser => ({
  id,
  username,
  displayName: username.toUpperCase(),
  email: `${username}@corp.example`,
  bio,
  avatarUrl: null,
  passwordHash: "salt:hash",
  createdAt: T,
});

function deck(
  id: string,
  ownerId: string,
  visibility: Deck["visibility"],
  over: Partial<Deck> = {},
): Deck {
  return {
    id,
    ownerId,
    name: id,
    format: "commander",
    notes: "",
    visibility,
    allowForks: false,
    forkedFromId: null,
    preferredBranchId: null,
    commander: null,
    colors: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function friends(a: string, b: string, status: Friendship["status"] = "accepted"): Friendship {
  return {
    id: `f-${a.slice(0, 8)}-${b.slice(0, 8)}-${status}`,
    requesterId: a,
    addresseeId: b,
    status,
    createdAt: T,
  };
}

beforeEach(() => {
  db = {
    users: [
      user(ALICE, "alice_u", "alice bio"),
      user(BOB, "bob_u", "bob secret bio"),
      user(CAROL, "carol_u", "carol bio"),
      user(DAVE, "dave_u", "dave bio"),
      user(FRANK, "frank_u", "frank bio"),
      user(GINA, "gina_u", "gina bio"),
    ],
    friendships: [friends(ALICE, BOB), friends(CAROL, BOB)],
    favorites: [],
    decks: [
      deck("alice-private", ALICE, "private", { name: "Alice private", notes: "ALICE PRIVATE NOTES" }),
      deck("alice-public", ALICE, "public", { name: "Alice public" }),
      deck("bob-public", BOB, "public", {
        name: "Bob public",
        notes: "BOB PUBLIC NOTES",
        updatedAt: "2026-10-22T00:00:00.000Z",
      }),
      deck("bob-friends", BOB, "friends", {
        name: "Bob friends",
        notes: "BOB FRIENDS NOTES",
        updatedAt: "2026-10-23T00:00:00.000Z",
      }),
      deck("bob-secret", BOB, "private", {
        name: "Bob secret",
        notes: "BOB SECRET NOTES",
        updatedAt: "2026-10-24T00:00:00.000Z",
      }),
      deck("bob-fork", BOB, "private", {
        name: "Bob fork of Alice",
        notes: "BOB FORK NOTES",
        forkedFromId: "alice-public",
        updatedAt: "2026-10-21T00:00:00.000Z",
      }),
      deck("frank-friends", FRANK, "friends", { name: "Frank friends", notes: "FRANK FRIENDS NOTES" }),
      deck("frank-secret", FRANK, "private", { name: "Frank secret", notes: "FRANK SECRET NOTES" }),
    ],
    deckCards: [],
    comments: [
      {
        id: "c-gina",
        deckId: "alice-public",
        authorId: GINA,
        body: "nice",
        createdAt: T,
      } satisfies Comment,
    ],
    sessions: {},
  };
});

function names(decks: { name: string }[]) {
  return decks.map((d) => d.name);
}

describe("getUserProfile visibility", () => {
  it("lets an accepted friend see public and friends-only decks, plus a private fork of their own deck, and never a private original", async () => {
    const view = await repo.getUserProfile(ALICE, "BOB_U");
    expect(view?.profile).toMatchObject({
      id: BOB,
      username: "bob_u",
      displayName: "BOB_U",
      bio: "bob secret bio",
      avatarUrl: null,
    });
    expect(names(view!.decks)).toEqual(["Bob friends", "Bob public", "Bob fork of Alice"]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("BOB SECRET NOTES");
    expect(json).not.toContain("bob_u@corp.example");
    expect(json).not.toContain("passwordHash");
    expect(json).toContain("BOB FORK NOTES");
  });

  it("lets another friend of the forker see public and friends-only decks, not the private fork", async () => {
    const view = await repo.getUserProfile(CAROL, "bob_u");
    expect(view?.profile.bio).toBe("bob secret bio");
    expect(names(view!.decks)).toEqual(["Bob friends", "Bob public"]);
    expect(JSON.stringify(view)).not.toContain("BOB FORK NOTES");
    expect(JSON.stringify(view)).not.toContain("BOB SECRET NOTES");
  });

  it("lets a signed-in non-friend see only public decks, and not the bio", async () => {
    const view = await repo.getUserProfile(DAVE, "bob_u");
    expect(view?.profile.bio).toBeNull();
    expect(names(view!.decks)).toEqual(["Bob public"]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("bob secret bio");
    expect(json).not.toContain("BOB FRIENDS NOTES");
    expect(json).not.toContain("BOB SECRET NOTES");
    expect(json).not.toContain("BOB FORK NOTES");
  });

  it("hides bio from a logged-out viewer and still lists only public decks", async () => {
    const view = await repo.getUserProfile(null, "bob_u");
    expect(view?.profile.bio).toBeNull();
    expect(names(view!.decks)).toEqual(["Bob public"]);
    expect(JSON.stringify(view)).not.toContain("bob secret bio");
  });

  it("returns null for a player with no visible deck, comment, or friendship", async () => {
    db.decks = db.decks.filter((d) => d.ownerId !== FRANK);
    db.friendships = db.friendships.filter((f) => f.requesterId !== FRANK && f.addresseeId !== FRANK);
    expect(await repo.getUserProfile(DAVE, "frank_u")).toBeNull();
    expect(await repo.getUserProfile(null, "frank_u")).toBeNull();
  });

  it("lets a pending friend read the profile, but not the bio or friends-only decks", async () => {
    db.friendships.push(friends(ALICE, FRANK, "pending"));
    const view = await repo.getUserProfile(ALICE, "frank_u");
    expect(view?.profile.username).toBe("frank_u");
    expect(view?.profile.bio).toBeNull();
    expect(view?.decks).toEqual([]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("frank bio");
    expect(json).not.toContain("FRANK FRIENDS NOTES");
    expect(json).not.toContain("FRANK SECRET NOTES");
  });

  it("lets a declined friend read the profile, but not the bio", async () => {
    db.friendships.push(friends(ALICE, FRANK, "declined"));
    const view = await repo.getUserProfile(ALICE, "frank_u");
    expect(view?.profile.username).toBe("frank_u");
    expect(view?.profile.bio).toBeNull();
    expect(JSON.stringify(view)).not.toContain("frank bio");
  });

  it("shows the owner every deck they have, including private", async () => {
    const view = await repo.getUserProfile(ALICE, "alice_u");
    expect(view?.profile.bio).toBe("alice bio");
    expect(names(view!.decks)).toContain("Alice private");
    expect(names(view!.decks)).toContain("Alice public");
  });

  it("lets someone who can see a comment read that author's profile, without the bio", async () => {
    const signedIn = await repo.getUserProfile(DAVE, "gina_u");
    expect(signedIn?.profile.bio).toBeNull();
    expect(signedIn?.decks).toEqual([]);
    expect(JSON.stringify(signedIn)).not.toContain("gina bio");

    const anon = await repo.getUserProfile(null, "gina_u");
    expect(anon?.profile.bio).toBeNull();
    expect(anon?.profile.username).toBe("gina_u");
  });

  it("rejects usernames that are not an exact handle", async () => {
    expect(await repo.getUserProfile(ALICE, "bo")).toBeNull();
    expect(await repo.getUserProfile(ALICE, "bob")).toBeNull();
    expect(await repo.getUserProfile(ALICE, "bob_u%")).toBeNull();
    expect(await repo.getUserProfile(ALICE, "bob u")).toBeNull();
    expect(await repo.getUserProfile(ALICE, "../bob_u")).toBeNull();
  });
});
