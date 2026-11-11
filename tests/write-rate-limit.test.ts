import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

// P3-1: every previously unmetered write uses limit() and the shared message.

const ME = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";

const repo = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
  get(target, key: string) {
    target[key] ??= vi.fn(async () => undefined);
    return target[key];
  },
});
const updateStore = vi.fn<(fn: unknown) => Promise<never>>(async () => {
  throw new Error("profile write should have been rate limited");
});

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: ME, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return { getRepository: () => repo, userMessage: errors.userMessage, DataError: errors.DataError };
});
vi.mock("@/lib/data/store", () => ({
  updateStore: (fn: unknown) => updateStore(fn),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const comments = await import("@/lib/actions/comments");
const favorites = await import("@/lib/actions/favorites");
const friends = await import("@/lib/actions/friends");
const decks = await import("@/lib/actions/decks");
const collection = await import("@/lib/actions/collection");
const auth = await import("@/lib/actions/auth");

const deckForm = () => {
  const fd = new FormData();
  fd.set("name", "Deck");
  fd.set("format", "modern");
  fd.set("notes", "");
  fd.set("visibility", "public");
  fd.set("allowForks", "on");
  fd.set("colors", "UB");
  return fd;
};

const profileForm = () => {
  const fd = new FormData();
  fd.set("displayName", "Me");
  fd.set("bio", "hello");
  return fd;
};

const collectionPatch = { quantity: 2, finish: "foil" as const, condition: "NM" as const, forTrade: true };

beforeEach(() => {
  updateStore.mockClear();
  for (const fn of Object.values(repo as unknown as Record<string, ReturnType<typeof vi.fn>>)) fn.mockClear();
  setRateLimitStoreForTests({ hit: async () => ({ allowed: false, retryAfterSec: 60 }) });
});

describe("unmetered writes now return the rate-limit message", () => {
  const cases: [string, () => Promise<{ error?: string }>][] = [
    ["addCommentAction", () => comments.addCommentAction(OTHER, "hello")],
    ["sendFriendRequestAction", () => friends.sendFriendRequestAction(OTHER)],
    ["respondFriendRequestAction", () => friends.respondFriendRequestAction(OTHER, true)],
    ["removeFriendAction", () => friends.removeFriendAction(OTHER)],
    ["addFavoriteAction", () => favorites.addFavoriteAction({ scryfallId: "s1", cardName: "Sol Ring" })],
    ["removeFavoriteAction", () => favorites.removeFavoriteAction(OTHER)],
    ["updateProfileAction", () => auth.updateProfileAction(profileForm())],
    ["updateCollectionCardAction", () => collection.updateCollectionCardAction(OTHER, collectionPatch)],
    ["removeCollectionCardAction", () => collection.removeCollectionCardAction(OTHER)],
    ["setCollectionVisibilityAction", () => collection.setCollectionVisibilityAction("public")],
    ["createDeckAction", () => decks.createDeckAction(deckForm())],
    ["updateDeckMetaAction", () => decks.updateDeckMetaAction(OTHER, deckForm())],
    ["deleteDeckAction", () => decks.deleteDeckAction(OTHER)],
    ["updateCardQuantityAction", () => decks.updateCardQuantityAction(OTHER, OTHER, 2)],
    ["moveCardToBoardAction", () => decks.moveCardToBoardAction(OTHER, OTHER, "side")],
    ["createCategoryAction", () => decks.createCategoryAction(OTHER, "Ramp")],
    ["renameCategoryAction", () => decks.renameCategoryAction(OTHER, OTHER, "Draw")],
    ["deleteCategoryAction", () => decks.deleteCategoryAction(OTHER, OTHER)],
    ["moveCardToCategoryAction", () => decks.moveCardToCategoryAction(OTHER, OTHER, null)],
    ["reorderDeckSectionsAction", () => decks.reorderDeckSectionsAction(OTHER, [])],
    ["setPreferredBranchAction", () => decks.setPreferredBranchAction(OTHER, null)],
  ];

  it.each(cases)("%s is refused before it writes", async (_name, run) => {
    await expect(run()).resolves.toMatchObject({ error: RATE_LIMITED_MESSAGE });
    expect(updateStore).not.toHaveBeenCalled();
    const writes = Object.values(repo as unknown as Record<string, ReturnType<typeof vi.fn>>).filter(
      (fn) => fn.mock.calls.length > 0,
    );
    expect(writes).toEqual([]);
  });
});

describe("comment budget", () => {
  beforeEach(() => {
    setRateLimitStoreForTests(new MemoryStore(() => 1_700_000_000_000));
  });

  it("allows 30 comments per user per 10 minutes, then the shared message", async () => {
    for (let i = 0; i < 30; i++) {
      expect(await comments.addCommentAction(OTHER, `note ${i}`)).toEqual({ success: true });
    }
    expect(repo.addComment).toHaveBeenCalledTimes(30);
    expect(await comments.addCommentAction(OTHER, "one more")).toEqual({
      error: RATE_LIMITED_MESSAGE,
      retryAfterSec: 600,
    });
    expect(repo.addComment).toHaveBeenCalledTimes(30);
  });
});
