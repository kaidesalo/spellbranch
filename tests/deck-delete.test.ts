import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, LocalUser } from "@/lib/data/store";
import { createMockClient, eqValue, ok, type Call } from "./helpers/supabase-mock";

// deleteDeckAction on both backends: only the owner deletes, nobody else
// (signed in or not) can, and what a delete takes with it. The database side
// (RLS policy, FK cascades, triggers) is in supabase/tests/deck_delete.sql.

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

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const DECK = "d0000000-0000-4000-8000-000000000001";
const FORK = "d0000000-0000-4000-8000-000000000002";
const OTHER = "d0000000-0000-4000-8000-000000000003";
const BOB_PARENT = "d0000000-0000-4000-8000-000000000004";

// null = signed out: requireUser() redirects to /login, like the real one.
let me: string | null = ALICE;
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => {
    if (!me) throw new Error("NEXT_REDIRECT /login");
    return { id: me, email: "me@example.test", username: "me_u", displayName: "Me" };
  },
}));

let backend: "local" | "supabase" = "local";
let supabaseCalls: Call[] = [];
// The fake PostgREST applies the delete policy: a DELETE only matches the
// caller's own deck (auth.uid() = owner_id), like RLS would.
const owners: Record<string, string> = { [DECK]: ALICE, [FORK]: BOB, [OTHER]: ALICE };
function supabaseRespond(c: Call) {
  if (c.table === "decks" && c.op === "delete") {
    const id = eqValue(c, "id");
    const asked = eqValue(c, "owner_id");
    return ok(id && owners[id as string] === me && asked === me ? [{ id }] : []);
  }
  return undefined;
}
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  const { localRepository } = await import("@/lib/data/local");
  const { createSupabaseRepository } = await import("@/lib/data/supabase");
  return {
    getRepository: () => {
      if (backend === "local") return localRepository;
      const mock = createMockClient(supabaseRespond);
      supabaseCalls = mock.calls;
      return createSupabaseRepository(mock.factory);
    },
    userMessage: errors.userMessage,
    DataError: errors.DataError,
  };
});
const revalidated: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => void revalidated.push(p) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const { deleteDeckAction } = await import("@/lib/actions/decks");

const T = "2026-11-05T12:00:00.000Z";
const user = (id: string, username: string): LocalUser => ({
  id, username, displayName: username, email: `${username}@example.test`, bio: "", avatarUrl: null, passwordHash: "x:y", createdAt: T,
});
const deck = (id: string, ownerId: string, over: Partial<DataStore["decks"][number]> = {}) => ({
  id, ownerId, name: `Deck ${id.slice(-1)}`, format: "modern" as const, notes: "", visibility: "public" as const,
  allowForks: true, forkedFromId: null, preferredBranchId: null, commander: null, colors: ["U"], createdAt: T, updatedAt: T,
  ...over,
});
const card = (id: string, deckId: string) => ({
  id, deckId, scryfallId: `s-${id}`, cardName: "Opt", imageUri: null, manaCost: "{U}",
  typeLine: "Instant", colors: ["U"], colorIdentity: ["U"], oracleText: null, quantity: 1, createdAt: T,
});
const comment = (id: string, deckId: string, authorId: string) => ({ id, deckId, authorId, body: "hi", createdAt: T });

beforeEach(() => {
  me = ALICE;
  backend = "local";
  supabaseCalls = [];
  revalidated.length = 0;
  db = {
    users: [user(ALICE, "alice_u"), user(BOB, "bob_u")],
    friendships: [], favorites: [], sessions: {},
    decks: [
      deck(DECK, ALICE, { preferredBranchId: FORK }),
      deck(FORK, BOB, { forkedFromId: DECK }),
      deck(OTHER, ALICE),
      // Bob's deck whose preferred branch is the deck Alice deletes.
      deck(BOB_PARENT, BOB, { preferredBranchId: DECK }),
    ] as DataStore["decks"],
    deckCards: [card("c1", DECK), card("c2", DECK), card("c3", FORK), card("c4", OTHER)] as DataStore["deckCards"],
    comments: [comment("m1", DECK, BOB), comment("m2", DECK, ALICE), comment("m3", OTHER, BOB)] as DataStore["comments"],
  };
});

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id).sort();

describe("deleteDeckAction, local backend", () => {
  it("the owner deletes the deck and is sent to /decks", async () => {
    await expect(deleteDeckAction(DECK)).rejects.toThrow("NEXT_REDIRECT /decks");
    expect(ids(db.decks)).toEqual([FORK, OTHER, BOB_PARENT].sort());
    expect(revalidated).toEqual(["/decks", "/dashboard"]);
  });

  it("cascades the deck's cards and comments (anyone's), and keeps forks", async () => {
    await expect(deleteDeckAction(DECK)).rejects.toThrow("NEXT_REDIRECT");
    expect(ids(db.deckCards)).toEqual(["c3", "c4"]);
    expect(ids(db.comments)).toEqual(["m3"]);
    const fork = db.decks.find((d) => d.id === FORK)!;
    expect(fork.forkedFromId).toBeNull();
    expect(fork.colors).toEqual(["U"]);
    expect(db.decks.find((d) => d.id === BOB_PARENT)!.preferredBranchId).toBeNull();
  });

  it("a non-owner can't delete, and nothing changes", async () => {
    me = BOB;
    const before = structuredClone(db);
    expect(await deleteDeckAction(DECK)).toEqual({ error: "You cannot delete this deck" });
    expect(db).toEqual(before);
    expect(revalidated).toEqual([]);
  });

  it("a signed-out caller is sent to /login and nothing changes", async () => {
    me = null;
    const before = structuredClone(db);
    await expect(deleteDeckAction(DECK)).rejects.toThrow("NEXT_REDIRECT /login");
    expect(db).toEqual(before);
  });

  it("an unknown or malformed id is refused", async () => {
    expect(await deleteDeckAction("d0000000-0000-4000-8000-0000000000ff")).toEqual({ error: "You cannot delete this deck" });
    expect((await deleteDeckAction("not-a-uuid")).error).toBeTruthy();
    expect(db.decks).toHaveLength(4);
  });
});

describe("deleteDeckAction, Supabase backend", () => {
  beforeEach(() => {
    backend = "supabase";
  });

  it("the owner's delete is scoped to id and owner_id, then redirects", async () => {
    await expect(deleteDeckAction(DECK)).rejects.toThrow("NEXT_REDIRECT /decks");
    expect(supabaseCalls).toHaveLength(1);
    expect(supabaseCalls[0]).toMatchObject({ table: "decks", op: "delete", returning: "id" });
    expect(supabaseCalls[0].filters).toEqual(expect.arrayContaining([["eq", "id", DECK], ["eq", "owner_id", ALICE]]));
    expect(revalidated).toEqual(["/decks", "/dashboard"]);
  });

  it("a non-owner's delete matches 0 rows and is refused", async () => {
    me = BOB;
    expect(await deleteDeckAction(DECK)).toEqual({ error: "You cannot delete this deck" });
    expect(supabaseCalls[0].filters).toContainEqual(["eq", "owner_id", BOB]);
    expect(revalidated).toEqual([]);
  });

  it("a signed-out caller never reaches the database", async () => {
    me = null;
    await expect(deleteDeckAction(DECK)).rejects.toThrow("NEXT_REDIRECT /login");
    expect(supabaseCalls).toEqual([]);
  });

  it("a malformed id never reaches the database", async () => {
    expect((await deleteDeckAction("not-a-uuid")).error).toBeTruthy();
    expect(supabaseCalls).toEqual([]);
  });
});
