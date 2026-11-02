import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertRateLimitConfig, rateLimitSecretProblem } from "@/lib/rate-limit/config";
import { bucketKey, getRateLimitSecret, normalizeEmail } from "@/lib/rate-limit/keys";
import { MemoryStore } from "@/lib/rate-limit/memory-store";
import { POLICIES, retryAfterFor } from "@/lib/rate-limit/policies";
import type { RateLimitStore } from "@/lib/rate-limit/store";
import {
  RATE_LIMITED_MESSAGE,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  limit,
  limitMessage,
  setRateLimitStoreForTests,
} from "@/lib/rate-limit";

const SECRET = "test-only-rate-limit-secret-0123456789abcdef";

describe("MemoryStore", () => {
  it("allows up to the limit in one window, then blocks with retry-after", async () => {
    let now = 1_200_000_000_000; // a multiple of 300 s
    const store = new MemoryStore(() => now);
    for (let i = 0; i < 3; i++) expect((await store.hit("k", 3, 300)).allowed).toBe(true);
    now += 100_000;
    expect(await store.hit("k", 3, 300)).toEqual({ allowed: false, retryAfterSec: 200 });
  });

  it("starts again in the next window", async () => {
    let now = 1_200_000_000_000;
    const store = new MemoryStore(() => now);
    await store.hit("k", 1, 300);
    expect((await store.hit("k", 1, 300)).allowed).toBe(false);
    now += 300_000;
    expect((await store.hit("k", 1, 300)).allowed).toBe(true);
  });

  it("keeps keys separate", async () => {
    const store = new MemoryStore();
    await store.hit("a", 1, 60);
    expect((await store.hit("b", 1, 60)).allowed).toBe(true);
  });
  it("sweeps expired counters at most once a minute (Cipher R3)", async () => {
    let now = 1_200_000_000_000;
    const store = new MemoryStore(() => now);
    for (let i = 0; i < 5; i++) await store.hit(`old-${i}`, 10, 60);
    expect(store.size).toBe(5);

    now += 59_000; // windows not over yet, and no sweep due
    await store.hit("new-1", 10, 60);
    expect(store.size).toBe(6);

    now += 2_000; // 61 s: the old windows have ended and a sweep is due
    await store.hit("new-2", 10, 60);
    expect(store.size).toBe(1); // only new-2: new-1 was in the same, now finished, window
  });

  it("doesn't sweep again within the minute", async () => {
    let now = 1_200_000_000_000;
    const store = new MemoryStore(() => now);
    const sweeps = vi.spyOn(store as unknown as { dropExpired: (n: number) => void }, "dropExpired");
    now += 60_000;
    for (let i = 0; i < 100; i++) await store.hit(`k-${i}`, 10, 60);
    expect(sweeps).toHaveBeenCalledTimes(1);
  });

  it("refuses new keys past the hard cap, so limit() fails closed (Cipher R3)", async () => {
    const now = 1_200_000_000_000;
    const store = new MemoryStore(() => now, { maxEntries: 3 });
    for (let i = 0; i < 3; i++) await store.hit(`k-${i}`, 10, 60);
    await expect(store.hit("one-too-many", 10, 60)).rejects.toThrow(/full/);
    // Existing counters keep counting (nobody's count is reset).
    expect((await store.hit("k-0", 2, 60)).allowed).toBe(true);
    expect((await store.hit("k-0", 2, 60)).allowed).toBe(false);
    expect(store.size).toBe(3);

    setRateLimitStoreForTests(store);
    vi.stubEnv("SPELLBRANCH_RATE_LIMIT_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await limit("sign-in", { ip: "198.51.100.7", email: "cap@example.test" })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    setRateLimitStoreForTests();
    vi.unstubAllEnvs();
  });

  it("frees room once expired counters are swept", async () => {
    let now = 1_200_000_000_000;
    const store = new MemoryStore(() => now, { maxEntries: 2 });
    await store.hit("a", 10, 60);
    await store.hit("b", 10, 60);
    now += 60_000;
    expect((await store.hit("c", 10, 60)).allowed).toBe(true);
    expect(store.size).toBe(1);
  });
});

describe("keys", () => {
  it("normalizes email", () => {
    expect(normalizeEmail("  Someone@Example.TEST ")).toBe("someone@example.test");
  });

  it("is 64 hex characters and contains no raw value", () => {
    const key = bucketKey(SECRET, "sign-in", "email+ip", "someone@example.test|203.0.113.7");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("someone");
    expect(key).not.toContain("203.0.113.7");
  });

  it("differs by policy, bucket and secret", () => {
    const base = bucketKey(SECRET, "sign-in", "ip", "1.2.3.4");
    expect(bucketKey(SECRET, "sign-up", "ip", "1.2.3.4")).not.toBe(base);
    expect(bucketKey(SECRET, "sign-in", "email", "1.2.3.4")).not.toBe(base);
    expect(bucketKey(`${SECRET}x`, "sign-in", "ip", "1.2.3.4")).not.toBe(base);
  });
});

describe("rate-limit secret", () => {
  it.each([
    ["missing", {}],
    ["short", { SPELLBRANCH_RATE_LIMIT_SECRET: "too-short" }],
    ["equal to AUTH_SECRET", { SPELLBRANCH_RATE_LIMIT_SECRET: SECRET, AUTH_SECRET: SECRET }],
  ])("fails in production when %s", (_label, env) => {
    expect(rateLimitSecretProblem(env)).not.toBeNull();
    expect(() => getRateLimitSecret({ ...env, NODE_ENV: "production" })).toThrow();
    expect(() => assertRateLimitConfig({ ...env, SPELLBRANCH_CLIENT_IP_HEADER: "x-real-ip" })).toThrow(
      /SPELLBRANCH_RATE_LIMIT_SECRET/,
    );
  });

  it("falls back to a dev-only secret outside production, with a warning", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getRateLimitSecret({})).toMatch(/dev-only/);
    vi.restoreAllMocks();
  });

  it("accepts a 32-byte secret that differs from AUTH_SECRET", () => {
    expect(getRateLimitSecret({ SPELLBRANCH_RATE_LIMIT_SECRET: SECRET, AUTH_SECRET: "other" })).toBe(SECRET);
  });
});

describe("policies", () => {
  it("checks the IP bucket first wherever there is one", () => {
    for (const buckets of Object.values(POLICIES)) expect(buckets[0].by).toBe("ip");
  });

  it("uses the agreed numbers for sign-in (Cipher F6) and sign-up", () => {
    expect(POLICIES["sign-in"]).toEqual([
      { by: "ip", limit: 20, windowSec: 300 },
      { by: "email+ip", limit: 10, windowSec: 900 },
      { by: "email", limit: 50, windowSec: 3600 },
    ]);
    expect(POLICIES["sign-up"][0]).toEqual({ by: "ip", limit: 10, windowSec: 3600 });
  });

  it("limits commander lookups per IP and per user (Cipher PR #9 L1)", () => {
    expect(POLICIES["commander-lookup"]).toEqual([
      { by: "ip", limit: 60, windowSec: 600 },
      { by: "user", limit: 30, windowSec: 600 },
    ]);
    expect(retryAfterFor("commander-lookup")).toBe(600);
    expect(POLICIES["scryfall-search"]).toEqual([{ by: "ip", limit: 60, windowSec: 60 }]); // L2
  });

  it("retry-after is the policy's longest window", () => {
    expect(retryAfterFor("sign-in")).toBe(3600);
    expect(retryAfterFor("confirm")).toBe(300);
  });
});

describe("limit()", () => {
  beforeEach(() => {
    vi.stubEnv("SPELLBRANCH_RATE_LIMIT_SECRET", SECRET);
    setRateLimitStoreForTests(new MemoryStore());
  });
  afterEach(() => {
    setRateLimitStoreForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const ip = "203.0.113.7";

  it("blocks sign-in after 10 tries for one (email, IP)", async () => {
    for (let i = 0; i < 10; i++) expect(await limit("sign-in", { ip, email: "a@example.test" })).toEqual({ ok: true });
    expect(await limit("sign-in", { ip, email: "A@Example.test " })).toEqual({
      ok: false,
      reason: "limited",
      retryAfterSec: 3600,
    });
    // Same email from another IP still works: one IP can't lock the account.
    expect((await limit("sign-in", { ip: "198.51.100.9", email: "a@example.test" })).ok).toBe(true);
  });

  it("blocks an IP after 20 sign-ins across different emails", async () => {
    for (let i = 0; i < 20; i++) await limit("sign-in", { ip, email: `u${i}@example.test` });
    expect((await limit("sign-in", { ip, email: "fresh@example.test" })).ok).toBe(false);
  });

  it("email-only bucket caps one account across many IPs at 50 / hour", async () => {
    for (let i = 0; i < 50; i++) await limit("sign-in", { ip: `10.0.0.${i}`, email: "v@example.test" });
    expect((await limit("sign-in", { ip: "10.0.1.1", email: "v@example.test" })).ok).toBe(false);
  });

  it("stops at the first blocking bucket: an IP-blocked attempt doesn't touch the email buckets", async () => {
    const hits: number[] = [];
    const inner = new MemoryStore();
    const store: RateLimitStore = {
      hit: async (key, max, windowSec) => {
        hits.push(windowSec);
        return inner.hit(key, max, windowSec);
      },
    };
    setRateLimitStoreForTests(store);
    for (let i = 0; i < 20; i++) await limit("sign-in", { ip, email: `u${i}@example.test` });
    hits.length = 0;
    await limit("sign-in", { ip, email: "victim@example.test" });
    expect(hits).toEqual([300]);
  });

  it("gives the same answer whichever bucket tripped", async () => {
    for (let i = 0; i < 20; i++) await limit("sign-in", { ip, email: `u${i}@example.test` });
    const byIp = await limit("sign-in", { ip, email: "x@example.test" });
    for (let i = 0; i < 10; i++) await limit("sign-in", { ip: "198.51.100.1", email: "y@example.test" });
    const byEmail = await limit("sign-in", { ip: "198.51.100.1", email: "y@example.test" });
    expect(byIp).toEqual(byEmail);
  });

  it("never passes a raw email or IP to the store", async () => {
    const keys: string[] = [];
    setRateLimitStoreForTests({ hit: async (key) => (keys.push(key), { allowed: true, retryAfterSec: 0 }) });
    await limit("sign-in", { ip, email: "someone@example.test" });
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("someone");
      expect(key).not.toContain(ip);
    }
  });

  it("fails closed when the store throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setRateLimitStoreForTests({ hit: async () => Promise.reject(new Error("db down")) });
    const result = await limit("sign-up", { ip, email: "someone@example.test" });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(error.mock.calls.join(" ")).not.toContain("someone");
  });

  it("fails closed when the store hangs past the timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let aborted = false;
    setRateLimitStoreForTests(
      {
        hit: (_key, _max, _window, signal) =>
          new Promise(() => signal?.addEventListener("abort", () => (aborted = true))),
      },
      20,
    );
    expect(await limit("confirm", { ip })).toEqual({ ok: false, reason: "unavailable" });
    expect(aborted).toBe(true);
  });

  it("has one generic message per outcome", () => {
    expect(limitMessage({ ok: false, reason: "limited", retryAfterSec: 1 })).toBe(RATE_LIMITED_MESSAGE);
    expect(limitMessage({ ok: false, reason: "unavailable" })).toBe(RATE_LIMIT_UNAVAILABLE_MESSAGE);
  });
});
