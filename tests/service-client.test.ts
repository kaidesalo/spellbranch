import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Review M1/I2, Cipher F4: the secret-key client is plain supabase-js with no
// session, created only when used, and exposes exactly two typed RPC calls.

const FAKE_SECRET_KEY = "sb_secret_test_only_fake_0000000000"; // never a real key
const URL = "https://abcdefghijklmnop.supabase.co";

const mocks = vi.hoisted(() => {
  const abortSignal = vi.fn();
  const rpc = vi.fn();
  const createClient = vi.fn(() => ({ rpc }));
  return { abortSignal, rpc, createClient };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

/** A thenable like supabase-js's query builder, with .abortSignal(). */
function builder(result: { data: unknown; error: unknown }) {
  const b = {
    abortSignal: mocks.abortSignal.mockImplementation(() => b),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return b;
}

async function load() {
  vi.resetModules();
  return import("@/lib/supabase/service");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test_only");
  vi.stubEnv("SUPABASE_SECRET_KEY", FAKE_SECRET_KEY);
  mocks.createClient.mockClear();
  mocks.abortSignal.mockClear();
  mocks.rpc.mockReset().mockImplementation(() => builder({ data: [{ allowed: true, retry_after: 0 }], error: null }));
});

afterEach(() => vi.unstubAllEnvs());

describe("src/lib/supabase/service.ts", () => {
  it("exports only rateLimitHit and usernameAvailable", async () => {
    expect(Object.keys(await load()).sort()).toEqual(["rateLimitHit", "usernameAvailable"]);
  });

  it("creates one plain supabase-js client with no session, lazily", async () => {
    const service = await load();
    expect(mocks.createClient).not.toHaveBeenCalled();

    await service.rateLimitHit({ p_key: "k", p_limit: 1, p_window_seconds: 60 });
    await service.usernameAvailable("felix_1");
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledWith(URL, FAKE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("rateLimitHit calls rate_limit_hit with the args and passes the abort signal", async () => {
    const service = await load();
    const signal = new AbortController().signal;
    const args = { p_key: "k", p_limit: 5, p_window_seconds: 300 };
    expect(await service.rateLimitHit(args, signal)).toEqual({
      data: [{ allowed: true, retry_after: 0 }],
      error: null,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("rate_limit_hit", args);
    expect(mocks.abortSignal).toHaveBeenCalledWith(signal);
  });

  it("returns only the error's code and message", async () => {
    mocks.rpc.mockImplementation(() =>
      builder({ data: null, error: { code: "42501", message: "permission denied", details: "x", hint: "y" } }),
    );
    const service = await load();
    expect(await service.rateLimitHit({ p_key: "k", p_limit: 1, p_window_seconds: 60 })).toEqual({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
  });

  it("usernameAvailable re-checks the format before calling the database", async () => {
    mocks.rpc.mockImplementation(() => builder({ data: true, error: null }));
    const service = await load();
    for (const bad of ["ab", "a%", "no spaces", "x".repeat(25), "", null as unknown as string]) {
      expect(await service.usernameAvailable(bad)).toEqual({ data: false, error: null });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();

    expect(await service.usernameAvailable("Felix_1")).toEqual({ data: true, error: null });
    expect(mocks.rpc).toHaveBeenCalledWith("username_available", { candidate: "Felix_1" });
  });

  it.each([
    ["missing", undefined, /not set/],
    ["a legacy JWT", "eyJhbGciOiJIUzI1NiJ9.fake.fake", /legacy service_role JWT/],
    ["a publishable key", "sb_publishable_test_only", /sb_secret_/],
  ])("refuses to create a client when the key is %s", async (_what, value, error) => {
    vi.stubEnv("SUPABASE_SECRET_KEY", value);
    const service = await load();
    await expect(service.rateLimitHit({ p_key: "k", p_limit: 1, p_window_seconds: 60 })).rejects.toThrow(error);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
