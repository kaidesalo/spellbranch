import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

const ME = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";

const users = [
  { id: ME, avatarPreset: "ghalta" as string | null },
  { id: OTHER, avatarPreset: "sai" as string | null },
];
const flags = vi.hoisted(() => ({
  signedIn: true,
  supabase: false,
  dbError: null as { message: string; code?: string } | null,
}));
const eq = vi.hoisted(() => vi.fn(async () => ({ error: flags.dbError })));
const update = vi.hoisted(() => vi.fn(() => ({ eq })));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => {
    if (!flags.signedIn) throw new Error("NEXT_REDIRECT /login");
    return { id: ME, email: "me@example.test", username: "me_u", displayName: "Me" };
  },
}));
vi.mock("@/lib/data/store", () => ({
  updateStore: async (fn: (store: { users: typeof users }) => void) => {
    fn({ users });
  },
}));
vi.mock("@/lib/supabase/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase/config")>()),
  isSupabaseConfigured: () => flags.supabase,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ update }),
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { setAvatarPresetAction } = await import("@/lib/actions/auth");

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  flags.signedIn = true;
  flags.supabase = false;
  flags.dbError = null;
  users[0].avatarPreset = "ghalta";
  users[1].avatarPreset = "sai";
  update.mockClear();
  eq.mockClear();
});

describe("setAvatarPresetAction", () => {
  it("rejects a signed-out caller before any write", async () => {
    flags.signedIn = false;
    await expect(setAvatarPresetAction("giada")).rejects.toThrow("NEXT_REDIRECT /login");
    expect(users[0].avatarPreset).toBe("ghalta");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a key that is not on the allowlist", async () => {
    expect(await setAvatarPresetAction("https://cdn.example/a.png")).toEqual({
      error: "Choose a profile picture from the list.",
    });
    expect(await setAvatarPresetAction("atraxa")).toEqual({
      error: "Choose a profile picture from the list.",
    });
    expect(users[0].avatarPreset).toBe("ghalta");
    expect(update).not.toHaveBeenCalled();
  });

  it("saves an allowlisted key on the caller's row only", async () => {
    expect(await setAvatarPresetAction("giada")).toEqual({ success: true });
    expect(users[0].avatarPreset).toBe("giada");
    expect(users[1].avatarPreset).toBe("sai");
  });

  it("clears the preset when the choice is null", async () => {
    expect(await setAvatarPresetAction(null)).toEqual({ success: true });
    expect(users[0].avatarPreset).toBeNull();
    expect(users[1].avatarPreset).toBe("sai");
  });

  it("writes the key through the caller's own profile update and explains a missing column", async () => {
    flags.supabase = true;
    expect(await setAvatarPresetAction("lathliss")).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({ avatar_preset: "lathliss" });
    expect(eq).toHaveBeenCalledWith("id", ME);
    expect(eq).not.toHaveBeenCalledWith("id", OTHER);

    flags.dbError = {
      code: "PGRST204",
      message: "Could not find the 'avatar_preset' column of 'profiles' in the schema cache",
    };
    expect(await setAvatarPresetAction("sai")).toEqual({
      error: "Profile pictures aren't available yet.",
    });
  });
});
