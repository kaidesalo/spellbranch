import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/lib/data/store";

// P1: other users' emails must never appear in what the server hands the UI
// (search results, friend rows, deck owner objects).

const VICTIM_EMAIL = "victim.person@corp.example";
const ME_EMAIL = "me@example.test";

const now = "2026-10-20T14:00:00.000Z";
const me = {
  id: "me",
  email: ME_EMAIL,
  username: "me_u",
  displayName: "Me",
  bio: "",
  avatarUrl: null,
  passwordHash: "salt:hash",
  createdAt: now,
};
const victim = {
  ...me,
  id: "victim",
  email: VICTIM_EMAIL,
  username: "victim_u",
  displayName: "Victim",
  passwordHash: "salt2:hash2",
};

function fixture(): DataStore {
  return {
    users: [me, victim],
    friendships: [
      { id: "f1", requesterId: "victim", addresseeId: "me", status: "accepted", createdAt: now },
    ],
    favorites: [],
    decks: [
      {
        id: "d1",
        ownerId: "victim",
        name: "Victim public deck",
        format: "commander",
        notes: "",
        visibility: "public",
        allowForks: true,
        forkedFromId: null,
        preferredBranchId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    deckCards: [],
    comments: [],
    sessions: {},
  };
}

let sessionUser: { id: string; email: string; username: string; displayName: string } | null;

vi.mock("@/lib/data/store", () => ({
  readStore: async () => fixture(),
  updateStore: async () => undefined,
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

function expectNoEmail(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).not.toContain(VICTIM_EMAIL);
  expect(json).not.toContain(ME_EMAIL);
  expect(json).not.toMatch(/"email"/);
  expect(json).not.toMatch(/passwordHash/);
}

describe("public profiles carry no email", () => {
  beforeEach(() => {
    sessionUser = { id: me.id, email: me.email, username: me.username, displayName: me.displayName };
  });

  it("toPublicProfile drops email even when given a full user record", async () => {
    const { toPublicProfile } = await import("@/lib/queries/profiles");
    const profile = toPublicProfile(victim);
    expect(profile).not.toHaveProperty("email");
    expect(profile).not.toHaveProperty("passwordHash");
    expect(profile).toMatchObject({ id: "victim", username: "victim_u" });
  });

  it("findProfileAction (exact username) results have no email", async () => {
    const { findProfileAction } = await import("@/lib/actions/friends");
    const results = await findProfileAction("Victim_U");
    expect(results.map((r) => r.username)).toEqual(["victim_u"]);
    expect(Object.keys(results[0]).sort()).toEqual(["avatarUrl", "displayName", "id", "username"]);
    expectNoEmail(results);
    // No substring search any more.
    expect(await findProfileAction("v")).toEqual([]);
  });

  it("getFriendsData rows have no email", async () => {
    const { getFriendsData } = await import("@/lib/queries/friends");
    const data = await getFriendsData();
    expect(data.friends).toHaveLength(1);
    expectNoEmail(data);
  });

  it("deck owner objects have no email, signed in or not", async () => {
    const { listVisibleDecks, getDeckById } = await import("@/lib/queries/decks");
    const signedIn = await listVisibleDecks("public");
    expect(signedIn[0]?.owner?.username).toBe("victim_u");
    expectNoEmail(signedIn);
    expectNoEmail(await getDeckById("d1"));

    sessionUser = null;
    const anonymous = await listVisibleDecks("public");
    expect(anonymous).toHaveLength(1);
    expectNoEmail(anonymous);
  });
});
