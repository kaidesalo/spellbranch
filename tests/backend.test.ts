import { describe, expect, it } from "vitest";
import { getBackend, hasSupabaseKeys, isSupabaseConfigured } from "@/lib/supabase/config";

const keys = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
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
