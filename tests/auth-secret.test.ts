import { describe, expect, it, vi } from "vitest";
import { resolveAuthSecret } from "@/lib/auth/session";

describe("resolveAuthSecret", () => {
  it("uses AUTH_SECRET when set", () => {
    expect(resolveAuthSecret({ AUTH_SECRET: "s3cret-value", NODE_ENV: "production" })).toBe("s3cret-value");
  });

  it("throws in production without AUTH_SECRET (and never falls back to the Supabase key)", () => {
    expect(() =>
      resolveAuthSecret({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" }),
    ).toThrow(/AUTH_SECRET is required/);
  });

  it("uses a dev-only secret with a warning outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = resolveAuthSecret({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" });
    expect(secret).not.toBe("sb_publishable_x");
    expect(secret).toMatch(/dev/);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
