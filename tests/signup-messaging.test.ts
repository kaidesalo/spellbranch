import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

// L2: a duplicate email must look exactly like a successful sign-up.
// L4: sign-up enforces an 8-character minimum; sign-in doesn't.

type SignUpResult = {
  data: { session: unknown; user: unknown };
  error: { code?: string; message: string; status?: number } | null;
};

let signUpResult: SignUpResult;
const signUp = vi.fn(async () => signUpResult);
const signInWithPassword = vi.fn(async () => ({ data: {}, error: { code: "invalid_credentials", message: "x" } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signUp, signInWithPassword } }),
}));
// The username check goes through the secret-key client (I2).
vi.mock("@/lib/supabase/service", () => ({
  usernameAvailable: async () => ({ data: true, error: null }),
  rateLimitHit: async () => {
    throw new Error("tests use an in-memory store");
  },
}));
// Server actions read the client IP from the request headers (review M1).
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
// Never touch the local JSON store from these tests.
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
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const valid = {
  email: "someone@example.test",
  password: "correct-horse",
  username: "someone_1",
  displayName: "Someone",
};

describe("Supabase sign-up messaging (L2)", () => {
  beforeEach(() => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test_only");
    vi.stubEnv("SPELLBRANCH_SITE_URL", "http://localhost:3847");
    signUp.mockClear();
    setRateLimitStoreForTests(new MemoryStore()); // fresh in-memory counters
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function signUpWith(result: SignUpResult) {
    signUpResult = result;
    const { signUpAction } = await import("@/lib/actions/auth");
    return signUpAction(form(valid));
  }

  it("returns the generic check-your-email result on success (confirmations on)", async () => {
    const ok = await signUpWith({ data: { session: null, user: { id: "u" } }, error: null });
    expect(ok).toEqual({ success: true, message: "Check your email to confirm your account." });
    expect(signUp).toHaveBeenCalledOnce();
  });

  it.each(["user_already_exists", "email_exists"])(
    "%s returns exactly the same result as a successful sign-up",
    async (code) => {
      const fresh = await signUpWith({ data: { session: null, user: { id: "u" } }, error: null });
      const dup = await signUpWith({
        data: { session: null, user: null },
        error: { code, message: "User already registered" },
      });
      expect(dup).toEqual(fresh);
      expect(JSON.stringify(dup)).not.toMatch(/already|exists|registered/i);
    },
  );

  it.each([
    ["over_email_send_rate_limit", { code: "over_email_send_rate_limit", message: "email rate limit exceeded", status: 429 }],
    ["any other 429", { message: "Too many requests", status: 429 }],
  ])("Supabase's email-send limit (%s) looks like a successful sign-up (Cipher R2)", async (_label, error) => {
    // Registered (confirmed) email: GoTrue sends nothing and answers 200.
    const registered = await signUpWith({ data: { session: null, user: { id: "fake" } }, error: null });
    // New email while the sender is rate limited: GoTrue errors.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fresh = await signUpWith({ data: { session: null, user: null }, error });
    expect(fresh).toEqual(registered);
    expect(JSON.stringify(fresh)).not.toMatch(/rate|limit|could not/i);
  });

  it("rejects passwords under 8 characters before calling Supabase (L4)", async () => {
    const { signUpAction } = await import("@/lib/actions/auth");
    const res = await signUpAction(form({ ...valid, password: "1234567" }));
    expect(res.error).toMatch(/at least 8/);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("sign-in does not apply the sign-up length rule (old 6-char accounts)", async () => {
    const { signInAction } = await import("@/lib/actions/auth");
    const res = await signInAction(form({ email: valid.email, password: "123456" }));
    expect(res).toEqual({ error: "Invalid email or password" });
    expect(signInWithPassword).toHaveBeenCalled();
  });
});
