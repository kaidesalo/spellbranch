import { describe, expect, it } from "vitest";
import {
  getBackend,
  getSiteOrigin,
  hasSupabaseKeys,
  isSupabaseConfigured,
  parseSiteUrl,
} from "@/lib/supabase/config";

const keys = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
  SPELLBRANCH_SITE_URL: "http://localhost:3847",
};

describe("backend switch", () => {
  it("defaults to local with no env", () => {
    expect(getBackend({})).toBe("local");
  });

  it("stays local when only the keys are set", () => {
    expect(getBackend({ ...keys })).toBe("local");
    expect(isSupabaseConfigured({ ...keys })).toBe(false);
  });

  it("stays local for SPELLBRANCH_BACKEND=local", () => {
    expect(getBackend({ ...keys, SPELLBRANCH_BACKEND: "local" })).toBe("local");
  });

  it("uses supabase only with the flag AND real keys", () => {
    expect(getBackend({ ...keys, SPELLBRANCH_BACKEND: "supabase" })).toBe("supabase");
    expect(getBackend({ ...keys, SPELLBRANCH_BACKEND: " Supabase " })).toBe("supabase");
  });

  it("throws when supabase is requested without keys", () => {
    expect(() => getBackend({ SPELLBRANCH_BACKEND: "supabase" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when supabase is requested with .env.example placeholders", () => {
    expect(() =>
      getBackend({
        SPELLBRANCH_BACKEND: "supabase",
        NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "your-anon-key",
      }),
    ).toThrow();
    expect(hasSupabaseKeys({ NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" })).toBe(false);
  });

  it("throws on an unknown backend name", () => {
    expect(() => getBackend({ ...keys, SPELLBRANCH_BACKEND: "supbase" })).toThrow(/Unknown SPELLBRANCH_BACKEND/);
  });
});

describe("L6: production guard for the auth-only Supabase mode", () => {
  const supa = { ...keys, SPELLBRANCH_BACKEND: "supabase" };

  it("throws in production without SPELLBRANCH_ALLOW_HYBRID", () => {
    expect(() => getBackend({ ...supa, NODE_ENV: "production" })).toThrow(/SPELLBRANCH_ALLOW_HYBRID/);
    expect(() =>
      getBackend({ ...supa, NODE_ENV: "production", SPELLBRANCH_ALLOW_HYBRID: "true" }),
    ).toThrow(/SPELLBRANCH_ALLOW_HYBRID/);
    expect(() =>
      getBackend({ ...supa, NODE_ENV: "production", SPELLBRANCH_ALLOW_HYBRID: "0" }),
    ).toThrow(/SPELLBRANCH_ALLOW_HYBRID/);
  });

  it("allows production with SPELLBRANCH_ALLOW_HYBRID=1", () => {
    expect(getBackend({ ...supa, NODE_ENV: "production", SPELLBRANCH_ALLOW_HYBRID: "1" })).toBe(
      "supabase",
    );
  });

  it("does not affect development or the local backend", () => {
    expect(getBackend({ ...supa, NODE_ENV: "development" })).toBe("supabase");
    expect(getBackend({ ...keys, NODE_ENV: "production" })).toBe("local");
    expect(getBackend({ NODE_ENV: "production", SPELLBRANCH_BACKEND: "local" })).toBe("local");
  });

  it("requires SPELLBRANCH_SITE_URL in supabase mode", () => {
    const noSite: Record<string, string | undefined> = { ...supa, SPELLBRANCH_SITE_URL: undefined };
    expect(() => getBackend(noSite)).toThrow(/SPELLBRANCH_SITE_URL/);
    expect(() => getBackend({ ...noSite, SPELLBRANCH_SITE_URL: "not a url" })).toThrow(
      /SPELLBRANCH_SITE_URL/,
    );
    expect(() => getBackend({ ...noSite, SPELLBRANCH_SITE_URL: "javascript:alert(1)" })).toThrow(
      /SPELLBRANCH_SITE_URL/,
    );
    // Local mode doesn't need it.
    expect(getBackend({ SPELLBRANCH_BACKEND: "local" })).toBe("local");
  });

  it("normalizes the site URL to an origin", () => {
    expect(parseSiteUrl("https://spellbranch.example/")).toBe("https://spellbranch.example");
    expect(parseSiteUrl("http://localhost:3847/some/path")).toBe("http://localhost:3847");
    expect(getSiteOrigin({})).toBeNull();
  });
});
