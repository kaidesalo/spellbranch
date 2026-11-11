import { describe, expect, it } from "vitest";
import { DECK_COLS, createSupabaseRepository } from "@/lib/data/supabase";
import { answeringCopyLink, createMockClient, eqValue, ok, pgError, type Call } from "./helpers/supabase-mock";

// What the Supabase adapter asks PostgREST for a profile page. RLS is what
// actually hides rows; these tests lock the query shape so the app cannot
// widen it (no find_profile, no *, no copied_from_id, no visibility override).

const ME = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const DECK = "d0000000-0000-4000-8000-000000000001";
const T = "2026-10-20T14:00:00.000Z";

const bobProfile = { id: BOB, username: "bob_u", display_name: "Bob", avatar_url: "https://cdn.example/bob.png" };
const deckRow = {
  id: DECK,
  owner_id: BOB,
  name: "Bob public",
  format: "modern",
  notes: "visible notes",
  visibility: "public",
  allow_forks: true,
  forked_from_id: null,
  preferred_branch_id: null,
  created_at: T,
  updated_at: T,
};

const isTable = (c: Call, table: string) => c.table === table && c.op === "select";

function repoWith(respond: (c: Call) => ReturnType<typeof ok> | undefined) {
  const mock = createMockClient(answeringCopyLink(respond));
  return { repo: createSupabaseRepository(mock.factory), calls: mock.calls };
}

function profilePage(extra?: (c: Call) => ReturnType<typeof ok> | undefined) {
  return repoWith((c) => {
    const custom = extra?.(c);
    if (custom) return custom;
    if (c.fn === "profile_bio") return ok("hello bio");
    if (isTable(c, "public_profiles") && c.single) return ok(bobProfile);
    if (isTable(c, "decks") && eqValue(c, "owner_id") === BOB) return ok([deckRow]);
    if (isTable(c, "deck_cards")) return ok([{ deck_id: DECK, quantity: 3 }]);
    if (isTable(c, "decks")) return ok([]);
    if (isTable(c, "public_profiles")) return ok([bobProfile]);
    return undefined;
  });
}

describe("supabase getUserProfile", () => {
  it("looks the username up on public_profiles, reads only bio, and lists decks by owner with DECK_COLS", async () => {
    const { repo, calls } = profilePage();
    const view = await repo.getUserProfile(ME, "  Bob_U  ");

    expect(view?.profile).toEqual({
      id: BOB,
      username: "bob_u",
      displayName: "Bob",
      avatarUrl: "https://cdn.example/bob.png",
      bio: "hello bio",
    });
    expect(view?.decks).toHaveLength(1);
    expect(view?.decks[0]).toMatchObject({
      id: DECK,
      name: "Bob public",
      visibility: "public",
      cardCount: 3,
      copiedFromId: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/email/i);

    const lookup = calls[0];
    expect(lookup).toMatchObject({
      table: "public_profiles",
      columns: "id, username, display_name, avatar_url",
      single: "maybeSingle",
    });
    // "_" stays literal. ilike would treat it as a wildcard.
    expect(lookup.filters).toEqual([["filter", "username", "imatch", "^Bob_U$"]]);

    const bio = calls.find((c) => c.fn === "profile_bio");
    expect(bio).toMatchObject({ fn: "profile_bio", args: { user_id: BOB } });
    expect(calls.some((c) => c.table === "profiles")).toBe(false);

    const list = calls.find((c) => isTable(c, "decks") && eqValue(c, "owner_id") === BOB);
    expect(list?.columns).toBe(DECK_COLS);
    expect(list?.columns).not.toContain("*");
    expect(list?.columns).not.toContain("copied_from_id");
    // No visibility predicate: RLS / can_view_deck is the whole rule.
    expect(list?.filters).toEqual([["eq", "owner_id", BOB]]);
    expect(list?.order).toEqual(["updated_at", { ascending: false }]);
    expect(calls.filter((c) => c.op === "rpc").map((c) => c.fn)).toEqual(["profile_bio"]);
  });

  it("does not read a bio for a logged-out viewer", async () => {
    const { repo, calls } = profilePage();
    const view = await repo.getUserProfile(null, "bob_u");
    expect(view?.profile.bio).toBeNull();
    expect(view?.decks).toHaveLength(1);
    expect(calls.some((c) => c.table === "profiles" || c.fn === "profile_bio")).toBe(false);
  });

  it("does not list decks when public_profiles returns nothing", async () => {
    const { repo, calls } = repoWith((c) => (isTable(c, "public_profiles") ? ok(null) : undefined));
    expect(await repo.getUserProfile(ME, "bob_u")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("public_profiles");
  });

  it("does not query for a username that cannot exist", async () => {
    const { repo, calls } = profilePage();
    expect(await repo.getUserProfile(ME, "bo")).toBeNull();
    expect(await repo.getUserProfile(ME, "bob_u%")).toBeNull();
    expect(await repo.getUserProfile(null, "a_b or true")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("hides bio on 42501 and still returns the profile and decks", async () => {
    const { repo } = profilePage((c) => (c.fn === "profile_bio" ? pgError("42501") : undefined));
    const view = await repo.getUserProfile(ME, "bob_u");
    expect(view?.profile.bio).toBeNull();
    expect(view?.profile.username).toBe("bob_u");
    expect(view?.decks).toHaveLength(1);
  });

  it("treats a null bio as hidden, and other profile_bio errors as failures before decks load", async () => {
    const missing = profilePage((c) => (c.fn === "profile_bio" ? ok(null) : undefined));
    expect((await missing.repo.getUserProfile(ME, "bob_u"))?.profile.bio).toBeNull();

    const { repo, calls } = profilePage((c) => (c.fn === "profile_bio" ? pgError("XX000") : undefined));
    await expect(repo.getUserProfile(ME, "bob_u")).rejects.toThrow(/profile_bio/);
    expect(calls.some((c) => c.table === "decks")).toBe(false);
  });
});
