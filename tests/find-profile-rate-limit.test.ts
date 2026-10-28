import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataError } from "@/lib/data/errors";
import { RATE_LIMITED_MESSAGE, RATE_LIMIT_UNAVAILABLE_MESSAGE, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

// Review M1/I2: findProfileAction is limited per IP (60/10min) and per user
// (30/10min) before the repository is called, and shows the database
// backstop's PT429 as the same generic message.

const mocks = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  userId: "a0000000-0000-4000-8000-000000000001",
  findProfile: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: mocks.userId, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return {
    getRepository: () => ({ findProfile: mocks.findProfile }),
    userMessage: errors.userMessage,
    DataError: errors.DataError,
  };
});

const { findProfileAction } = await import("@/lib/actions/friends");

const BOB = { id: "a0000000-0000-4000-8000-000000000002", username: "bob_u", displayName: "Bob", avatarUrl: null };
const user = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  mocks.requestHeaders = new Headers({ "x-real-ip": "203.0.113.5" });
  mocks.userId = user(1);
  mocks.findProfile.mockReset().mockResolvedValue([BOB]);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRateLimitStoreForTests();
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("findProfileAction rate limits", () => {
  it("allows 30 lookups per user per 10 minutes, from any IP", async () => {
    for (let i = 0; i < 30; i++) {
      mocks.requestHeaders = new Headers({ "x-real-ip": `10.0.0.${i}` });
      expect(await findProfileAction("bob_u")).toEqual({ profiles: [BOB] });
    }
    mocks.requestHeaders = new Headers({ "x-real-ip": "10.0.1.1" });
    expect(await findProfileAction("bob_u")).toEqual({
      profiles: [],
      error: RATE_LIMITED_MESSAGE,
      retryAfterSec: 600,
    });
    expect(mocks.findProfile).toHaveBeenCalledTimes(30);
  });

  it("allows 60 lookups per IP per 10 minutes, across accounts", async () => {
    for (let i = 0; i < 60; i++) {
      mocks.userId = user(100 + Math.floor(i / 20)); // 3 accounts, 20 each
      expect((await findProfileAction("bob_u")).profiles).toHaveLength(1);
    }
    mocks.userId = user(999);
    expect((await findProfileAction("bob_u")).error).toBe(RATE_LIMITED_MESSAGE);
    expect(mocks.findProfile).toHaveBeenCalledTimes(60);
  });

  it("doesn't count lookups that fail validation", async () => {
    for (let i = 0; i < 40; i++) await findProfileAction("x".repeat(65));
    expect((await findProfileAction("bob_u")).profiles).toHaveLength(1);
  });

  it("fails closed when the limiter is unavailable", async () => {
    setRateLimitStoreForTests({ hit: async () => { throw new Error("down"); } });
    expect(await findProfileAction("bob_u")).toEqual({ profiles: [], error: RATE_LIMIT_UNAVAILABLE_MESSAGE });
    expect(mocks.findProfile).not.toHaveBeenCalled();
  });

  it("shows the database backstop (PT429 -> DataError) as the generic message", async () => {
    mocks.findProfile.mockRejectedValue(new DataError(RATE_LIMITED_MESSAGE));
    expect(await findProfileAction("bob_u")).toEqual({ profiles: [], error: RATE_LIMITED_MESSAGE });
  });

  it("hides other repository errors behind a generic message", async () => {
    mocks.findProfile.mockRejectedValue(new Error("supabase find_profile failed (42501)"));
    expect(await findProfileAction("bob_u")).toEqual({ profiles: [], error: "Search failed. Please try again." });
  });
});
