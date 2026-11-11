import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE, limit, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

const getUserProfile = vi.fn<(username: string) => Promise<{
  profile: { id: string; username: string; displayName: string; avatarUrl: null; bio: null };
  decks: never[];
}>>(async () => ({
  profile: { id: "p1", username: "ada", displayName: "Ada", avatarUrl: null, bio: null },
  decks: [],
}));
const listTradeCollection = vi.fn<(viewer: string | null, owner: string) => Promise<never[]>>(async () => []);

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.50" }) }));
vi.mock("@/lib/queries/profiles", () => ({
  getUserProfile: (username: string) => getUserProfile(username),
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/data", () => ({
  getRepository: () => ({
    listTradeCollection: (viewer: string | null, owner: string) => listTradeCollection(viewer, owner),
  }),
}));

const { default: UserProfilePage } = await import("@/app/u/[username]/page");

beforeEach(() => {
  getUserProfile.mockClear();
  listTradeCollection.mockClear();
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  vi.stubEnv("SPELLBRANCH_RATE_LIMIT_SECRET", "y".repeat(32));
});

describe("/u/{username} rate limit", () => {
  it("allows 60 profile views per IP per minute", async () => {
    setRateLimitStoreForTests(new MemoryStore(() => 1_700_000_000_000));
    const ip = "203.0.113.50";
    for (let i = 0; i < 60; i++) expect(await limit("profile-view", { ip })).toEqual({ ok: true });
    const blocked = await limit("profile-view", { ip });
    expect(blocked).toMatchObject({ ok: false, reason: "limited", retryAfterSec: 60 });
  });

  it("shows the rate-limit message and does not load the trade list", async () => {
    setRateLimitStoreForTests({ hit: async () => ({ allowed: false, retryAfterSec: 60 }) });
    const page = await UserProfilePage({ params: Promise.resolve({ username: "ada" }) });
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(page);
    expect(html).toContain(RATE_LIMITED_MESSAGE);
    expect(getUserProfile).not.toHaveBeenCalled();
    expect(listTradeCollection).not.toHaveBeenCalled();
  });

  it("loads the profile when the view is allowed", async () => {
    setRateLimitStoreForTests({ hit: async () => ({ allowed: true, retryAfterSec: 0 }) });
    await UserProfilePage({ params: Promise.resolve({ username: "ada" }) });
    expect(getUserProfile).toHaveBeenCalledWith("ada");
    expect(listTradeCollection).toHaveBeenCalled();
  });
});
