import { beforeEach, describe, expect, it, vi } from "vitest";

// Cipher PR #3 review L2/L4: every server action checks its arguments before
// use. A bad payload gets a clean { error } (or [] for search) and never
// reaches the repository; nothing throws a 500.

const ME = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";

const repo = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
  get(target, key: string) {
    target[key] ??= vi.fn(async () => (key === "findProfile" ? [] : key === "createDeck" || key === "forkDeck" ? OTHER : undefined));
    return target[key];
  },
});
const repoCalls = () =>
  Object.entries(repo as unknown as Record<string, ReturnType<typeof vi.fn>>).filter(([, f]) => f.mock.calls.length > 0);

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: ME, email: "me@corp.example", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return { getRepository: () => repo, userMessage: errors.userMessage, DataError: errors.DataError };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const decks = await import("@/lib/actions/decks");
const comments = await import("@/lib/actions/comments");
const favorites = await import("@/lib/actions/favorites");
const friends = await import("@/lib/actions/friends");
const { LIMITS } = await import("@/lib/data/limits");

beforeEach(() => {
  for (const f of Object.values(repo as unknown as Record<string, ReturnType<typeof vi.fn>>)) f.mockClear();
});

// Payloads a client could send instead of the declared types.
const BAD_IDS: unknown[] = [undefined, null, 42, {}, [], "", "not-a-uuid", `${OTHER}x`, "x),status.eq.accepted", { toString: () => OTHER }];

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const goodDeck = { name: "Deck", format: "modern", notes: "", visibility: "public", allowForks: "on" };
const goodCard = { scryfallId: "s1", cardName: "Sol Ring", typeLine: "Artifact", colors: [], quantity: 1 };
const goodFav = { scryfallId: "s1", cardName: "Sol Ring" };

type AnyFn = (...args: unknown[]) => Promise<unknown>;
const call = (fn: unknown, ...args: unknown[]) => (fn as AnyFn)(...args);

describe("id arguments must be UUIDs", () => {
  const cases: [string, (id: unknown) => Promise<unknown>][] = [
    ["updateDeckMetaAction", (id) => call(decks.updateDeckMetaAction, id, form(goodDeck))],
    ["deleteDeckAction", (id) => call(decks.deleteDeckAction, id)],
    ["addCardToDeckAction", (id) => call(decks.addCardToDeckAction, id, goodCard)],
    ["updateCardQuantityAction (deck)", (id) => call(decks.updateCardQuantityAction, id, OTHER, 1)],
    ["updateCardQuantityAction (card)", (id) => call(decks.updateCardQuantityAction, OTHER, id, 1)],
    ["removeCardFromDeckAction", (id) => call(decks.removeCardFromDeckAction, OTHER, id)],
    ["forkDeckAction", (id) => call(decks.forkDeckAction, id)],
    ["setPreferredBranchAction (source)", (id) => call(decks.setPreferredBranchAction, id, OTHER)],
    ["addCommentAction", (id) => call(comments.addCommentAction, id, "hi")],
    ["removeFavoriteAction", (id) => call(favorites.removeFavoriteAction, id)],
    ["sendFriendRequestAction", (id) => call(friends.sendFriendRequestAction, id)],
    ["respondFriendRequestAction", (id) => call(friends.respondFriendRequestAction, id, true)],
    ["removeFriendAction", (id) => call(friends.removeFriendAction, id)],
  ];
  for (const [name, run] of cases) {
    it(`${name} rejects non-UUID ids with a clean error`, async () => {
      for (const bad of BAD_IDS) {
        const result = await run(bad);
        expect(result, `${name}(${String(bad)})`).toEqual({ error: expect.any(String) });
      }
      expect(repoCalls()).toEqual([]);
    });
  }

  it("setPreferredBranchAction accepts null (clear) but not other non-UUIDs for the branch", async () => {
    expect(await call(decks.setPreferredBranchAction, OTHER, null)).toEqual({ success: true });
    for (const bad of BAD_IDS.filter((b) => b !== null)) {
      expect(await call(decks.setPreferredBranchAction, OTHER, bad)).toEqual({ error: expect.any(String) });
    }
    expect(repo.setPreferredBranch.mock.calls).toEqual([[ME, OTHER, null]]);
  });
});

describe("comment bodies", () => {
  it("a non-string body is a clean error, not a 500", async () => {
    for (const bad of [undefined, null, 42, {}, ["hi"], { trim: () => "hi" }, true]) {
      expect(await call(comments.addCommentAction, OTHER, bad)).toEqual({ error: "Comment must be text" });
    }
    expect(repoCalls()).toEqual([]);
  });

  it("empty and over-long bodies are refused; the limit is inclusive", async () => {
    expect(await comments.addCommentAction(OTHER, "   ")).toEqual({ error: "Comment cannot be empty" });
    expect(await comments.addCommentAction(OTHER, "x".repeat(LIMITS.commentBody + 1))).toEqual({ error: "Comment is too long" });
    expect(repoCalls()).toEqual([]);
    expect(await comments.addCommentAction(OTHER, ` ${"x".repeat(LIMITS.commentBody)} `)).toEqual({ success: true });
    expect(repo.addComment.mock.calls[0][2]).toHaveLength(LIMITS.commentBody);
  });
});

describe("deck forms", () => {
  it("non-FormData payloads are refused", async () => {
    for (const bad of [undefined, null, "name=x", { name: "x" }, 1]) {
      expect(await call(decks.createDeckAction, bad)).toEqual({ error: "Invalid deck" });
      expect(await call(decks.updateDeckMetaAction, OTHER, bad)).toEqual({ error: "Invalid deck" });
    }
    expect(repoCalls()).toEqual([]);
  });

  it("enforces the name and notes limits", async () => {
    const tooLong = await decks.updateDeckMetaAction(OTHER, form({ ...goodDeck, name: "n".repeat(LIMITS.deckName + 1) }));
    expect(tooLong.error).toMatch(/at most 80/);
    const blank = await decks.updateDeckMetaAction(OTHER, form({ ...goodDeck, name: "   " }));
    expect(blank.error).toBe("Deck name is required");
    const notes = await decks.updateDeckMetaAction(OTHER, form({ ...goodDeck, notes: "x".repeat(LIMITS.deckNotes + 1) }));
    expect(notes.error).toMatch(/at most 2000/);
    expect(repoCalls()).toEqual([]);
    expect(await decks.updateDeckMetaAction(OTHER, form({ ...goodDeck, name: "n".repeat(80), notes: "x".repeat(2000) }))).toEqual({ success: true });
  });
});

describe("card and favorite payloads", () => {
  const over: [string, unknown][] = [
    ["scryfallId", "s".repeat(LIMITS.scryfallId + 1)],
    ["cardName", "c".repeat(LIMITS.cardName + 1)],
    ["typeLine", "t".repeat(LIMITS.typeLine + 1)],
    ["manaCost", "m".repeat(LIMITS.manaCost + 1)],
    ["oracleText", "o".repeat(LIMITS.oracleText + 1)],
    ["imageUri", `https://cards.scryfall.io/${"i".repeat(LIMITS.imageUri)}`],
    ["colors", Array(11).fill("W")],
    ["quantity", 100],
    ["quantity", "1"],
    ["cardName", 42],
  ];
  for (const [field, value] of over) {
    it(`addCardToDeckAction refuses ${field}=${String(value).slice(0, 12)}…`, async () => {
      expect(await call(decks.addCardToDeckAction, OTHER, { ...goodCard, [field]: value })).toEqual({ error: expect.any(String) });
      expect(repoCalls()).toEqual([]);
    });
  }

  it("addCardToDeckAction refuses non-objects", async () => {
    for (const bad of [undefined, null, "card", 1, []]) {
      expect(await call(decks.addCardToDeckAction, OTHER, bad)).toEqual({ error: expect.any(String) });
    }
    expect(repoCalls()).toEqual([]);
  });

  it("colors keep only W/U/B/R/G, once each", async () => {
    await decks.addCardToDeckAction(OTHER, { ...goodCard, colors: ["G", "X", "W", "G", "wubrg"] });
    expect(repo.addCard.mock.calls[0][2].colors).toEqual(["G", "W"]);
  });

  it("a card exactly at every limit is accepted", async () => {
    const atLimit = {
      scryfallId: "s".repeat(LIMITS.scryfallId), cardName: "c".repeat(LIMITS.cardName), typeLine: "t".repeat(LIMITS.typeLine),
      manaCost: "m".repeat(LIMITS.manaCost), oracleText: "o".repeat(LIMITS.oracleText),
      imageUri: `https://cards.scryfall.io/${"i".repeat(LIMITS.imageUri - 26)}`, colors: ["W", "U", "B", "R", "G"], quantity: 99,
    };
    expect(await decks.addCardToDeckAction(OTHER, atLimit)).toEqual({ success: true });
  });

  it("updateCardQuantityAction checks the quantity type and range", async () => {
    for (const bad of [-1, 100, 1.5, "2", null, NaN]) {
      expect(await call(decks.updateCardQuantityAction, OTHER, OTHER, bad)).toEqual({ error: "Quantity must be between 0 and 99" });
    }
    expect(repoCalls()).toEqual([]);
  });

  it("addFavoriteAction enforces the same limits", async () => {
    for (const [field, value] of over.filter(([f]) => ["scryfallId", "cardName", "typeLine", "manaCost", "imageUri"].includes(f))) {
      expect(await call(favorites.addFavoriteAction, { ...goodFav, [field]: value })).toEqual({ error: expect.any(String) });
    }
    for (const bad of [undefined, null, "x", 1]) {
      expect(await call(favorites.addFavoriteAction, bad)).toEqual({ error: expect.any(String) });
    }
    expect(repoCalls()).toEqual([]);
  });
});

describe("friends", () => {
  it("respondFriendRequestAction needs a real boolean", async () => {
    for (const bad of ["true", 1, null, undefined, {}]) {
      expect(await call(friends.respondFriendRequestAction, OTHER, bad)).toEqual({ error: "Invalid request" });
    }
    expect(repoCalls()).toEqual([]);
  });

  it("findProfileAction returns no profiles for non-strings and oversized input", async () => {
    for (const bad of [undefined, null, 42, {}, ["me_u"], "x".repeat(65)]) {
      expect(await call(friends.findProfileAction, bad)).toEqual({ profiles: [] });
    }
    expect(repoCalls()).toEqual([]);
  });
});

describe("auth form actions", () => {
  it("non-FormData payloads are a clean error", async () => {
    const auth = await import("@/lib/actions/auth");
    for (const bad of [undefined, null, "email=x", { email: "a@b.c" }]) {
      expect(await call(auth.signUpAction, bad)).toEqual({ error: "Invalid input" });
      expect(await call(auth.signInAction, bad)).toEqual({ error: "Invalid input" });
      expect(await call(auth.updateProfileAction, bad)).toEqual({ error: "Invalid input" });
    }
  });
});
