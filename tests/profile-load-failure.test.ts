import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";
import { PROFILE_UNAVAILABLE_MESSAGE } from "@/lib/auth/session";

// Sign-in can succeed while the profiles read fails. The failure is the
// PostgREST error from "Authenticated read related profiles" (002), which
// selects public.friendships as the signed-in role. The form must show a
// message. The log keeps the database error and not the email or password.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "kaide@example.test";

const flags = vi.hoisted(() => ({
  signInError: null as { code?: string; message: string; status?: number } | null,
  claims: {
    sub: "11111111-1111-4111-8111-111111111111",
    email: "kaide@example.test",
  } as Record<string, unknown> | null,
  profile: {
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      username: "kaide",
      display_name: "Kaide",
      avatar_url: null,
      avatar_preset: null,
    } as Record<string, unknown> | null,
    error: null as { message: string } | null,
  },
}));

const signInWithPassword = vi.hoisted(() =>
  vi.fn(async () => ({ data: {}, error: flags.signInError })),
);
const maybeSingle = vi.hoisted(() => vi.fn(async () => flags.profile));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword,
      signUp: vi.fn(),
      getClaims: async () => ({
        data: flags.claims ? { claims: flags.claims } : { claims: null },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  usernameAvailable: async () => ({ data: true, error: null }),
  rateLimitHit: async () => {
    throw new Error("tests use an in-memory store");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.8" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/data/store", () => ({
  readStore: async () => {
    throw new Error("store should not be used in supabase mode");
  },
  updateStore: async () => {
    throw new Error("store should not be used in supabase mode");
  },
}));

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_BACKEND", "supabase");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only_fake_0000000000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test_only");
  vi.stubEnv("SPELLBRANCH_SITE_URL", "http://localhost:3847");
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore());
  flags.signInError = null;
  flags.claims = { sub: USER_ID, email: EMAIL };
  flags.profile = {
    data: {
      id: USER_ID,
      username: "kaide",
      display_name: "Kaide",
      avatar_url: null,
      avatar_preset: null,
    },
    error: null,
  };
  signInWithPassword.mockClear();
  maybeSingle.mockClear();
});

describe("profile load after sign-in", () => {
  it("returns an error instead of redirecting when the profiles read is denied", async () => {
    flags.profile = { data: null, error: { message: "permission denied for table friendships" } };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { signInAction } = await import("@/lib/actions/auth");

    const result = await signInAction(form({ email: EMAIL, password: "correct-horse" }));

    expect(result).toEqual({ error: PROFILE_UNAVAILABLE_MESSAGE });
    expect(signInWithPassword).toHaveBeenCalledOnce();
    expect(maybeSingle).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).toContain("permission denied for table friendships");
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain("correct-horse");
    errorSpy.mockRestore();
  });

  it("redirects when the profile row loads", async () => {
    const { signInAction } = await import("@/lib/actions/auth");
    await expect(signInAction(form({ email: EMAIL, password: "correct-horse" }))).rejects.toThrow(
      "NEXT_REDIRECT /dashboard",
    );
  });

  it("still says the password was wrong when sign-in itself fails", async () => {
    flags.signInError = { message: "Invalid login credentials", code: "invalid_credentials" };
    const { signInAction } = await import("@/lib/actions/auth");
    const result = await signInAction(form({ email: EMAIL, password: "nope" }));
    expect(result).toEqual({ error: "Invalid email or password" });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("sends a protected page to /login?error=profile when the profile cannot be read", async () => {
    flags.profile = { data: null, error: { message: "permission denied for table friendships" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { requireUser } = await import("@/lib/auth/require-user");
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /login?error=profile");
  });

  it("sends a signed-out request to /login with no error param", async () => {
    flags.claims = null;
    const { requireUser } = await import("@/lib/auth/require-user");
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("shows the profile error on /login only while that session is unread", async () => {
    flags.profile = { data: null, error: { message: "permission denied for table comments" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: LoginPage } = await import("@/app/login/page");
    const denied = await LoginPage({ searchParams: Promise.resolve({}) });
    expect(textOf(denied)).toContain(PROFILE_UNAVAILABLE_MESSAGE);

    flags.claims = null;
    flags.profile = { data: null, error: null };
    const anonymous = await LoginPage({
      searchParams: Promise.resolve({ error: "profile" }),
    });
    expect(textOf(anonymous)).not.toContain(PROFILE_UNAVAILABLE_MESSAGE);
  });
});

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return textOf(props?.children);
  }
  return "";
}
