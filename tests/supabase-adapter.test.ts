import { describe, expect, it } from "vitest";
import { DataError } from "@/lib/data/errors";
import { FRIEND_MESSAGES } from "@/lib/data/friend-rules";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit/messages";
import { createSupabaseRepository } from "@/lib/data/supabase";
import { createMockClient, eqValue, ok, pgError, type Call } from "./helpers/supabase-mock";

// Supabase adapter with the client mocked: what it asks PostgREST for, and
// how it maps results and errors. RLS itself is covered by the pgTAP suites.

const ME = "a0000000-0000-4000-8000-000000000001";
const BOB = "a0000000-0000-4000-8000-000000000002";
const DECK = "d0000000-0000-4000-8000-000000000001";
const FORK = "d0000000-0000-4000-8000-000000000002";
const CARD = "c0000000-0000-4000-8000-000000000001";
const FRIENDSHIP = "f0000000-0000-4000-8000-000000000001";
const T = "2026-10-20T14:00:00.000Z";

const deckRow = (over: Record<string, unknown> = {}) => ({
  id: DECK,
  owner_id: BOB,
  name: "Bob public",
  format: "modern",
  notes: "",
  visibility: "public",
  allow_forks: true,
  forked_from_id: null,
  preferred_branch_id: null,
  created_at: T,
  updated_at: T,
  ...over,
});
const bobProfile = { id: BOB, username: "bob_u", display_name: "Bob", avatar_url: null };
const friendship = (over: Record<string, unknown> = {}) => ({
  id: FRIENDSHIP,
  requester_id: ME,
  addressee_id: BOB,
  status: "pending",
  created_at: T,
  ...over,
});

const isTable = (c: Call, table: string, op: Call["op"] = "select") =>
  c.table === table && c.op === op;

function repoWith(respond: (c: Call) => ReturnType<typeof ok> | undefined) {
  const mock = createMockClient(respond);
  return { repo: createSupabaseRepository(mock.factory), calls: mock.calls };
}

async function dataError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DataError);
    return (err as Error).message;
  }
  throw new Error("expected a DataError");
}

describe("supabase adapter: decks", () => {
  it("public list: filters, owner names from public_profiles, no email anywhere", async () => {
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "decks") && eqValue(c, "visibility") === "public") return ok([deckRow()]);
      if (isTable(c, "deck_cards")) return ok([{ deck_id: DECK, quantity: 4 }, { deck_id: DECK, quantity: 2 }]);
      if (isTable(c, "decks")) return ok([deckRow({ id: FORK, forked_from_id: DECK, owner_id: ME })]);
      if (isTable(c, "public_profiles")) return ok([bobProfile]);
    });

    const decks = await repo.listDecks(null, "public");
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({
      id: DECK,
      ownerId: BOB,
      cardCount: 6,
      forkCount: 1,
      owner: { id: BOB, username: "bob_u", displayName: "Bob", avatarUrl: null },
    });
    expect(decks[0].cards).toBeUndefined();

    const list = calls[0];
    expect(list.filters).toContainEqual(["eq", "visibility", "public"]);
    expect(list.filters).toContainEqual(["is", "forked_from_id", null]);
    expect(calls.some((c) => c.table === "profiles")).toBe(false);
    expect(JSON.stringify(decks)).not.toMatch(/email/i);
  });

  it("mine/friends need a viewer and filter on the caller", async () => {
    const { repo, calls } = repoWith((c) => (isTable(c, "decks") ? ok([]) : undefined));
    expect(await repo.listDecks(null, "mine")).toEqual([]);
    expect(await repo.listDecks(null, "friends")).toEqual([]);
    expect(calls).toHaveLength(0);

    await repo.listDecks(ME, "mine");
    expect(calls[0].filters).toEqual([
      ["eq", "owner_id", ME],
      ["is", "forked_from_id", null],
    ]);
    await repo.listDecks(ME, "friends");
    expect(calls[1].filters).toEqual([
      ["eq", "visibility", "friends"],
      ["neq", "owner_id", ME],
    ]);
  });

  it("getDeck: invisible (RLS) or malformed ids are null without errors", async () => {
    const { repo, calls } = repoWith((c) => (isTable(c, "decks") ? ok(null) : undefined));
    expect(await repo.getDeck(ME, DECK)).toBeNull();
    expect(await repo.getDeck(ME, "not-a-uuid")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("getDeck loads full cards and source deck", async () => {
    const { repo } = repoWith((c) => {
      if (isTable(c, "decks") && eqValue(c, "id") === FORK)
        return ok(deckRow({ id: FORK, forked_from_id: DECK, owner_id: ME }));
      if (isTable(c, "deck_cards"))
        return ok([
          {
            id: CARD, deck_id: FORK, scryfall_id: "s1", card_name: "Sol Ring", image_uri: null,
            mana_cost: "{1}", type_line: "Artifact", colors: null, oracle_text: null, quantity: 1, created_at: T,
          },
        ]);
      if (isTable(c, "decks") && c.filters[0][0] === "in" && c.filters[0][1] === "forked_from_id") return ok([]);
      if (isTable(c, "decks")) return ok([deckRow()]);
      if (isTable(c, "public_profiles")) return ok([]);
    });
    const deck = await repo.getDeck(ME, FORK);
    expect(deck?.cards?.[0]).toMatchObject({ cardName: "Sol Ring", colors: [] });
    expect(deck?.sourceDeck?.id).toBe(DECK);
  });

  it("createDeck never sends forked_from_id or preferred_branch_id", async () => {
    const { repo, calls } = repoWith((c) => (isTable(c, "decks", "insert") ? ok({ id: DECK }) : undefined));
    const id = await repo.createDeck(ME, {
      name: "New", format: "modern", notes: "", visibility: "private", allowForks: true, colors: ["B", "U"],
    });
    expect(id).toBe(DECK);
    expect(calls[0].payload).toEqual({
      owner_id: ME, name: "New", format: "modern", notes: "", visibility: "private", allow_forks: true,
      colors: ["U", "B"],
    });
  });

  it("updateDeck / deleteDeck: 0 rows (not owner) is a clear error", async () => {
    const { repo, calls } = repoWith(() => ok([]));
    const input = { name: "x", format: "modern" as const, notes: "", visibility: "public" as const, allowForks: true };
    expect(await dataError(repo.updateDeck(ME, DECK, input))).toBe("You cannot edit this deck");
    expect(await dataError(repo.deleteDeck(ME, DECK))).toBe("You cannot delete this deck");
    expect(calls[0].filters).toContainEqual(["eq", "owner_id", ME]);
    expect(calls[1]).toMatchObject({ op: "delete", returning: "id" });
  });

  it("forkDeck goes through rpc('fork_deck') and maps 42501/P0002", async () => {
    const good = repoWith((c) => (c.fn === "fork_deck" ? ok(FORK) : undefined));
    expect(await good.repo.forkDeck(ME, DECK)).toBe(FORK);
    expect(good.calls).toEqual([{ fn: "fork_deck", op: "rpc", args: { source: DECK }, filters: [] }]);

    for (const code of ["42501", "P0002"]) {
      const bad = repoWith(() => pgError(code));
      expect(await dataError(bad.repo.forkDeck(ME, DECK))).toBe("You are not allowed to fork this deck");
    }
  });

  it("setPreferredBranch: owner check, then an UPDATE; trigger rejection is a clear error", async () => {
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "decks")) return ok(deckRow({ owner_id: ME }));
      if (isTable(c, "decks", "update")) return pgError("23514");
    });
    expect(await dataError(repo.setPreferredBranch(ME, DECK, FORK))).toBe(
      "Branch does not belong to this deck",
    );
    expect(calls[1].payload).toEqual({ preferred_branch_id: FORK });

    const notOwner = repoWith((c) => (isTable(c, "decks") ? ok(deckRow()) : undefined));
    expect(await dataError(notOwner.repo.setPreferredBranch(ME, DECK, FORK))).toMatch(/source deck owner/);
    expect(notOwner.calls.some((c) => c.op === "update")).toBe(false);
  });
});

describe("supabase adapter: branches on your decks", () => {
  it("loads every direct fork of the caller's decks, not only friends", async () => {
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "decks") && c.columns === "id") return ok([{ id: DECK }]);
      if (isTable(c, "decks") && c.filters.some((f) => f[0] === "neq" && f[1] === "owner_id")) {
        return ok([
          deckRow({
            id: FORK, owner_id: BOB, forked_from_id: DECK, visibility: "private",
            allow_forks: false, name: "Bob branch",
          }),
        ]);
      }
      if (isTable(c, "decks") && c.filters.some((f) => f[0] === "in" && f[1] === "id")) {
        return ok([deckRow({ id: DECK, owner_id: ME, name: "Mine" })]);
      }
      if (isTable(c, "decks")) return ok([]);
      if (isTable(c, "deck_cards")) return ok([]);
      if (isTable(c, "public_profiles")) return ok([bobProfile]);
      return undefined;
    });

    const decks = await repo.listBranchesOnMyDecks(ME);
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({
      id: FORK,
      ownerId: BOB,
      visibility: "private",
      owner: { username: "bob_u" },
      sourceDeck: { id: DECK, name: "Mine" },
    });
    const forkQuery = calls.find((c) => c.filters.some((f) => f[0] === "neq" && f[1] === "owner_id"));
    expect(forkQuery?.filters).toEqual(expect.arrayContaining([
      ["in", "forked_from_id", [DECK]],
      ["neq", "owner_id", ME],
    ]));
    expect(calls.some((c) => c.table === "friendships")).toBe(false);
  });

  it("does not query forks when the caller owns no decks", async () => {
    const noneOwned = repoWith((c) => {
      if (isTable(c, "decks")) return ok([]);
      return undefined;
    });
    expect(await noneOwned.repo.listBranchesOnMyDecks(ME)).toEqual([]);
    expect(noneOwned.calls.some((c) => c.filters.some((f) => f[1] === "forked_from_id"))).toBe(false);
  });
});

describe("supabase adapter: hidden preferred branch (review L1)", () => {
  it("reports a preferred branch RLS hides from the viewer as null", async () => {
    const visible = deckRow({ id: FORK, forked_from_id: DECK, owner_id: ME });
    for (const [branches, expected] of [[[], null], [[visible], FORK]] as const) {
      const { repo } = repoWith((c) => {
        if (isTable(c, "decks") && c.single) return ok(deckRow({ preferred_branch_id: FORK }));
        if (isTable(c, "decks")) return ok(branches);
        if (isTable(c, "deck_cards")) return ok([]);
        if (isTable(c, "public_profiles")) return ok([]);
        return undefined;
      });
      const deck = await repo.getDeck(null, DECK);
      expect(deck?.preferredBranchId).toBe(expected);
    }
  });
});

describe("supabase adapter: cards", () => {
  it("addCard: non-owners are refused before any write", async () => {
    const { repo, calls } = repoWith((c) => (isTable(c, "decks") ? ok(deckRow()) : undefined));
    const card = {
      scryfallId: "s1", cardName: "Sol Ring", imageUri: null, manaCost: null, typeLine: "Artifact",
      colors: [], colorIdentity: [], oracleText: null, quantity: 1,
    };
    expect(await dataError(repo.addCard(ME, DECK, card))).toBe("You cannot edit this deck");
    expect(calls.every((c) => c.op === "select")).toBe(true);
  });

  it("addCard inserts new cards (non-Scryfall images dropped) and bumps existing ones up to 99", async () => {
    let existing: unknown = null;
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "decks")) return ok(deckRow({ owner_id: ME }));
      if (isTable(c, "deck_cards")) return ok(existing);
      return ok(null);
    });
    const card = {
      scryfallId: "s1", cardName: "Sol Ring", imageUri: "https://evil.example/x.png", manaCost: "{1}",
      typeLine: "Artifact", colors: ["C"], colorIdentity: [], oracleText: null, quantity: 1,
    };
    await repo.addCard(ME, DECK, card);
    const insert = calls.find((c) => isTable(c, "deck_cards", "insert"))!;
    expect(insert.payload).toMatchObject({ deck_id: DECK, scryfall_id: "s1", image_uri: null, quantity: 1, color_identity: [] });
    expect(calls.at(-1)).toMatchObject({ table: "decks", op: "update" });

    existing = { id: CARD, quantity: 98 };
    await repo.addCard(ME, DECK, { ...card, quantity: 4 });
    const update = calls.find((c) => isTable(c, "deck_cards", "update"))!;
    expect(update.payload).toEqual({ quantity: 99, color_identity: [] });
    expect(update.filters).toEqual([["eq", "id", CARD]]);
  });

  it("setCardQuantity: 0 deletes, missing card is an error", async () => {
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "decks")) return ok(deckRow({ owner_id: ME }));
      if (isTable(c, "deck_cards", "update")) return ok([]);
      return ok(null);
    });
    await repo.setCardQuantity(ME, DECK, CARD, 0);
    expect(calls.find((c) => c.op === "delete")?.filters).toEqual([
      ["eq", "id", CARD],
      ["eq", "deck_id", DECK],
    ]);
    expect(await dataError(repo.setCardQuantity(ME, DECK, CARD, 3))).toBe("Card not found in deck");
  });
});

describe("supabase adapter: comments and favorites", () => {
  it("listComments: authors from public_profiles only", async () => {
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "comments"))
        return ok([{ id: CARD, deck_id: DECK, author_id: BOB, body: "nice", created_at: T }]);
      if (isTable(c, "public_profiles")) return ok([bobProfile]);
    });
    const comments = await repo.listComments(null, DECK);
    expect(comments[0].author).toEqual({ id: BOB, username: "bob_u", displayName: "Bob" });
    expect(calls.map((c) => c.table)).toEqual(["comments", "public_profiles"]);
  });

  it("addComment: author is the caller; RLS refusal is a clear error", async () => {
    const { repo, calls } = repoWith(() => pgError("42501"));
    expect(await dataError(repo.addComment(ME, DECK, "hi"))).toBe("You cannot comment on this deck");
    expect(calls[0].payload).toEqual({ deck_id: DECK, author_id: ME, body: "hi" });
  });

  it("addFavorite treats a duplicate as success; other errors are not shown", async () => {
    const fav = { scryfallId: "s1", cardName: "Sol Ring", imageUri: null, manaCost: null, typeLine: null };
    await repoWith(() => pgError("23505")).repo.addFavorite(ME, fav);
    await expect(repoWith(() => pgError("42501")).repo.addFavorite(ME, fav)).rejects.not.toBeInstanceOf(
      DataError,
    );
  });
});

describe("supabase adapter: friends (P2)", () => {
  it("findProfile: rpc('find_profile'), exact name only, 0 or 1, never yourself", async () => {
    const { repo, calls } = repoWith((c) => (c.fn === "find_profile" ? ok([bobProfile]) : undefined));
    expect(await repo.findProfile(ME, " Bob_U ")).toEqual([
      { id: BOB, username: "bob_u", displayName: "Bob", avatarUrl: null },
    ]);
    expect(calls[0].args).toEqual({ username: "Bob_U" });

    // Invalid names never reach the database.
    expect(await repo.findProfile(ME, "b")).toEqual([]);
    expect(await repo.findProfile(ME, "bob%")).toEqual([]);
    expect(calls).toHaveLength(1);

    const self = repoWith(() => ok([{ ...bobProfile, id: ME }]));
    expect(await self.repo.findProfile(ME, "me_u")).toEqual([]);
  });

  it("findProfile: the database backstop (PT429) becomes the generic rate-limit message", async () => {
    const limited = await repoWith(() => pgError("PT429")).repo.findProfile(ME, "bob_u").catch((e) => e);
    expect(limited).toBeInstanceOf(DataError);
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);

    // Other errors stay internal (not shown to the user).
    const other = await repoWith(() => pgError("42501")).repo.findProfile(ME, "bob_u").catch((e) => e);
    expect(other).not.toBeInstanceOf(DataError);
  });

  it("sendFriendRequest inserts a pending row as the caller", async () => {
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "friendships")) return ok([]);
      if (isTable(c, "friendships", "insert")) return ok(null);
    });
    await repo.sendFriendRequest(ME, BOB);
    expect(calls[0].filters).toEqual([
      ["in", "requester_id", [ME, BOB]],
      ["in", "addressee_id", [ME, BOB]],
    ]);
    expect(calls[1].payload).toEqual({ requester_id: ME, addressee_id: BOB, status: "pending" });
  });

  it("re-sending after a decline says 'request declined' and never touches the row", async () => {
    const { repo, calls } = repoWith((c) =>
      isTable(c, "friendships") ? ok([friendship({ status: "declined" })]) : undefined,
    );
    expect(await dataError(repo.sendFriendRequest(ME, BOB))).toBe(FRIEND_MESSAGES.declined);
    expect(calls.every((c) => c.op === "select")).toBe(true);
  });

  it("a unique-violation race is explained from the caller's view", async () => {
    let selects = 0;
    const { repo } = repoWith((c) => {
      if (isTable(c, "friendships")) return ok(selects++ === 0 ? [] : [friendship({ status: "declined" })]);
      if (isTable(c, "friendships", "insert")) return pgError("23505");
    });
    expect(await dataError(repo.sendFriendRequest(ME, BOB))).toBe(FRIEND_MESSAGES.declined);
  });

  it("the user who declined may start over: one restart_friend_request() call (atomic, review I1)", async () => {
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "friendships"))
        return ok([friendship({ requester_id: BOB, addressee_id: ME, status: "declined" })]);
      if (c.op === "rpc" && c.fn === "restart_friend_request") return ok("new-id");
      return undefined;
    });
    await repo.sendFriendRequest(ME, BOB);
    expect(calls.map((c) => c.op)).toEqual(["select", "rpc"]);
    expect(calls[1].args).toEqual({ other: BOB });
  });

  it("restart: P0002 (row already gone) falls back to a plain insert; 23505 explains the new row", async () => {
    const declined = [friendship({ requester_id: BOB, addressee_id: ME, status: "declined" })];
    const gone = repoWith((c) => {
      if (c.op === "rpc") return pgError("P0002");
      if (isTable(c, "friendships")) return ok(declined);
      if (isTable(c, "friendships", "insert")) return ok(null);
      return undefined;
    });
    await gone.repo.sendFriendRequest(ME, BOB);
    expect(gone.calls.map((c) => c.op)).toEqual(["select", "rpc", "insert"]);
    expect(gone.calls[2].payload).toMatchObject({ requester_id: ME, addressee_id: BOB, status: "pending" });

    let selects = 0;
    const raced = repoWith((c) => {
      if (c.op === "rpc") return pgError("23505");
      if (isTable(c, "friendships")) {
        selects += 1;
        // After the failed restart, BOB has sent a fresh pending request.
        return ok(selects === 1 ? declined : [friendship({ requester_id: BOB, addressee_id: ME })]);
      }
      return undefined;
    });
    expect(await dataError(raced.repo.sendFriendRequest(ME, BOB))).toBe(FRIEND_MESSAGES.theyAsked);
    expect(raced.calls.map((c) => c.op)).toEqual(["select", "rpc", "select"]);
  });

  it("pending/accepted/self/bad id give clear errors without writes", async () => {
    for (const [row, msg] of [
      [friendship(), FRIEND_MESSAGES.alreadySent],
      [friendship({ requester_id: BOB, addressee_id: ME }), FRIEND_MESSAGES.theyAsked],
      [friendship({ status: "accepted" }), FRIEND_MESSAGES.alreadyFriends],
    ] as const) {
      const { repo, calls } = repoWith(() => ok([row]));
      expect(await dataError(repo.sendFriendRequest(ME, BOB))).toBe(msg);
      expect(calls.every((c) => c.op === "select")).toBe(true);
    }
    const { repo, calls } = repoWith(() => ok([]));
    expect(await dataError(repo.sendFriendRequest(ME, ME))).toBe(FRIEND_MESSAGES.self);
    expect(await dataError(repo.sendFriendRequest(ME, "x),status.eq.accepted"))).toBe(FRIEND_MESSAGES.notFound);
    expect(calls).toHaveLength(0);
  });

  it("only the addressee responds, and only to a pending request", async () => {
    // Requester tries to accept their own request.
    const asRequester = repoWith(() => ok(friendship()));
    expect(await dataError(asRequester.repo.respondFriendRequest(ME, FRIENDSHIP, true))).toBe(
      FRIEND_MESSAGES.requestNotFound,
    );
    expect(asRequester.calls.some((c) => c.op === "update")).toBe(false);

    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "friendships")) return ok(friendship({ requester_id: BOB, addressee_id: ME }));
      if (isTable(c, "friendships", "update")) return ok([{ id: FRIENDSHIP }]);
    });
    await repo.respondFriendRequest(ME, FRIENDSHIP, false);
    expect(calls[1].payload).toEqual({ status: "declined" });
    expect(calls[1].filters).toEqual([
      ["eq", "id", FRIENDSHIP],
      ["eq", "addressee_id", ME],
      ["eq", "status", "pending"],
    ]);
  });

  it("requester can cancel/unfriend but not delete a declined row", async () => {
    for (const status of ["pending", "accepted"]) {
      const { repo, calls } = repoWith((c) =>
        c.op === "select" ? ok(friendship({ status })) : ok([{ id: FRIENDSHIP }]),
      );
      await repo.removeFriendship(ME, FRIENDSHIP);
      expect(calls[1]).toMatchObject({ op: "delete", filters: [["eq", "id", FRIENDSHIP]] });
    }
    const { repo, calls } = repoWith(() => ok(friendship({ status: "declined" })));
    expect(await dataError(repo.removeFriendship(ME, FRIENDSHIP))).toBe(FRIEND_MESSAGES.cannotRemove);
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("getFriendsData: names from public_profiles, grouped by status and direction", async () => {
    const CAROL = "a0000000-0000-4000-8000-000000000003";
    const { repo, calls } = repoWith((c) => {
      if (isTable(c, "friendships"))
        return ok([
          friendship({ status: "accepted" }),
          friendship({ id: "x2", requester_id: CAROL, addressee_id: ME }),
          friendship({ id: "x3", requester_id: CAROL, addressee_id: ME, status: "declined" }),
        ]);
      if (isTable(c, "public_profiles"))
        return ok([bobProfile, { id: CAROL, username: "carol", display_name: "Carol", avatar_url: null }]);
    });
    const data = await repo.getFriendsData(ME);
    expect(data.friends.map((r) => r.profile.username)).toEqual(["bob_u"]);
    expect(data.incoming.map((r) => r.profile.username)).toEqual(["carol"]);
    expect(data.outgoing).toEqual([]);
    expect(calls.some((c) => c.table === "profiles")).toBe(false);
  });
});

describe("supabase adapter: own profile", () => {
  it("reads only the caller's own row", async () => {
    const { repo, calls } = repoWith(() =>
      ok({ id: ME, username: "me_u_1a2b", display_name: "Me", bio: null }),
    );
    expect(await repo.getOwnProfile(ME)).toEqual({ id: ME, username: "me_u_1a2b", displayName: "Me", bio: "" });
    expect(calls[0]).toMatchObject({ table: "profiles", filters: [["eq", "id", ME]] });
    expect(calls[0].columns).not.toMatch(/email/);
  });
});
