import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseEnv, hasSupabaseKeys, normalizeSupabaseUrl } from "@/lib/supabase/config";

// Fake values only.
const ORIGIN = "https://abcdefghijklmnop.supabase.co";
const KEY = "sb_publishable_test_only";

describe("normalizeSupabaseUrl", () => {
  it.each([
    ["plain", ORIGIN, false],
    ["trailing slash", `${ORIGIN}/`, false],
    ["/rest/v1", `${ORIGIN}/rest/v1`, true],
    ["/rest/v1/", `${ORIGIN}/rest/v1/`, true],
    ["whitespace", `  ${ORIGIN}/ \n`, false],
    ["/auth/v1", `${ORIGIN}/auth/v1`, true],
    ["/storage/v1/", `${ORIGIN}/storage/v1/`, true],
    ["/realtime/v1", `${ORIGIN}/realtime/v1`, true],
    ["other path", `${ORIGIN}/project/x`, true],
  ])("%s", (_name, input, changed) => {
    expect(normalizeSupabaseUrl(input)).toEqual({ url: ORIGIN, changed });
  });

  it("keeps a local port", () => {
    expect(normalizeSupabaseUrl("http://127.0.0.1:54321/rest/v1/")?.url).toBe("http://127.0.0.1:54321");
  });

  it.each([undefined, "", "   ", "not a url", "ftp://abcd.supabase.co", "abcd.supabase.co/rest/v1"])(
    "rejects %j",
    (input) => {
      expect(normalizeSupabaseUrl(input)).toBeNull();
    },
  );
});

describe("getSupabaseEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns the bare origin for a pasted /rest/v1/ URL", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { NEXT_PUBLIC_SUPABASE_URL: ` ${ORIGIN}/rest/v1/ `, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY };
    expect(getSupabaseEnv(env)).toEqual({ url: ORIGIN, key: KEY });
  });

  it("reads process.env by default", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `${ORIGIN}/auth/v1`);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", KEY);
    expect(getSupabaseEnv().url).toBe(ORIGIN);
    expect(hasSupabaseKeys()).toBe(true);
  });

  it("warns at most once, without the URL", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/supabase/config");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { NEXT_PUBLIC_SUPABASE_URL: `${ORIGIN}/rest/v1`, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY };
    fresh.getSupabaseEnv(env);
    fresh.getSupabaseEnv(env);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).not.toContain("abcdefghijklmnop");
    expect(message).not.toContain(KEY);
  });

  it("does not warn for a clean URL", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/supabase/config");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fresh.getSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: `${ORIGIN}/`, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["https://your-project.supabase.co", "not a url", ""])("rejects invalid or placeholder URL %j", (url) => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY };
    expect(() => getSupabaseEnv(env)).toThrow("Supabase is not configured");
    expect(hasSupabaseKeys(env)).toBe(false);
  });
});
