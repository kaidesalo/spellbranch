import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE, limit, limitMessage, setRateLimitStoreForTests } from "@/lib/rate-limit";

// M1 secret-key commit: Supabase mode counts in Postgres (rate_limit_hit via
// the secret-key client), shared by every instance; local mode in memory.

const rateLimitHit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ rateLimitHit, usernameAvailable: vi.fn() }));

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setRateLimitStoreForTests(); // no override: the real selection
  rateLimitHit.mockReset().mockResolvedValue({ data: [{ allowed: true, retry_after: 0 }], error: null });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRateLimitStoreForTests();
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
});

function supabaseMode() {
  vi.stubEnv("SPELLBRANCH_BACKEND", "supabase");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only_fake_0000000000"); // fake
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test_only");
  vi.stubEnv("SPELLBRANCH_SITE_URL", "http://localhost:3847");
}

describe("which store limit() uses", () => {
  it("Supabase mode: rate_limit_hit through the secret-key client, one call per bucket", async () => {
    supabaseMode();
    expect(await limit("sign-in", { ip: "203.0.113.1", email: "a@example.test" })).toEqual({ ok: true });
    expect(rateLimitHit).toHaveBeenCalledTimes(3);
    const [args, signal] = rateLimitHit.mock.calls[0];
    expect(args).toEqual({ p_key: expect.stringMatching(/^[0-9a-f]{64}$/), p_limit: 20, p_window_seconds: 300 });
    expect(signal).toBeInstanceOf(AbortSignal);
    // Keys are HMACs: no raw email or IP goes to the database.
    expect(JSON.stringify(rateLimitHit.mock.calls)).not.toMatch(/example\.test|203\.0\.113\.1/);
  });

  it("Supabase mode: a refusal from the database is a refusal", async () => {
    supabaseMode();
    rateLimitHit.mockResolvedValue({ data: [{ allowed: false, retry_after: 120 }], error: null });
    const result = await limit("confirm", { ip: "203.0.113.1" });
    expect(result).toEqual({ ok: false, reason: "limited", retryAfterSec: 300 });
    if (!result.ok) expect(limitMessage(result)).toBe(RATE_LIMITED_MESSAGE);
  });

  it("Supabase mode: fails closed when the RPC errors or the key is missing", async () => {
    supabaseMode();
    rateLimitHit.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await limit("confirm", { ip: "203.0.113.1" })).toEqual({ ok: false, reason: "unavailable" });
    rateLimitHit.mockRejectedValueOnce(new Error("SUPABASE_SECRET_KEY is not set."));
    expect(await limit("confirm", { ip: "203.0.113.1" })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("local mode: in memory, never the secret-key client", async () => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "local");
    vi.useFakeTimers({ toFake: ["Date"], now: 1_200_000_000_000 }); // never straddle a window
    for (let i = 0; i < 10; i++) expect((await limit("confirm", { ip: "203.0.113.1" })).ok).toBe(true);
    expect((await limit("confirm", { ip: "203.0.113.1" })).ok).toBe(false);
    expect(rateLimitHit).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
