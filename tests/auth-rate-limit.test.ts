import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE, RATE_LIMIT_UNAVAILABLE_MESSAGE, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";
import type { HitResult, RateLimitStore } from "@/lib/rate-limit/store";

// Review M1 + Cipher's required tests: sign-in and sign-up are rate limited
// before Supabase Auth is called, with generic replies that don't reveal
// whether an email is registered, and they fail closed.

const mocks = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  rpc: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signUp: mocks.signUp, signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
}));
// The username check goes through the secret-key client (I2).
vi.mock("@/lib/supabase/service", () => ({
  usernameAvailable: (candidate: string) => mocks.rpc("username_available", { candidate }),
  rateLimitHit: async () => {
    throw new Error("tests use an in-memory store");
  },
}));
vi.mock("@/lib/data/store", () => ({
  readStore: async () => ({ users: [], decks: [] }),
  updateStore: mocks.updateStore,
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  clearSessionCookie: async () => {},
}));

const { signInAction, signUpAction, signOutAction } = await import("@/lib/actions/auth");

const FIXED_NOW = 1_200_000_000_000; // a multiple of every window, so tests never straddle one

/** A MemoryStore that also records which limits were checked, in order. */
class RecordingStore implements RateLimitStore {
  calls: { limit: number; windowSec: number }[] = [];
  private inner = new MemoryStore(() => FIXED_NOW);
  hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
    this.calls.push({ limit, windowSec });
    return this.inner.hit(key, limit, windowSec);
  }
}

let store: RecordingStore;

function fromIp(ip: string, extra: Record<string, string> = {}) {
  mocks.requestHeaders = new Headers({ "x-real-ip": ip, ...extra });
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const signInForm = (email = "victim@example.test") => form({ email, password: "wrong-password" });
const signUpForm = (email: string, username = "new_player") =>
  form({ email, password: "correct-horse", username, displayName: "New" });

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_BACKEND", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test_only");
  vi.stubEnv("SPELLBRANCH_SITE_URL", "http://localhost:3847");
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  store = new RecordingStore();
  setRateLimitStoreForTests(store);
  fromIp("203.0.113.7");
  mocks.signInWithPassword.mockReset().mockResolvedValue({
    data: {},
    error: { code: "invalid_credentials", message: "Invalid login credentials" },
  });
  mocks.signUp.mockReset().mockResolvedValue({ data: { session: null, user: {} }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.updateStore.mockReset();
  mocks.signOut.mockClear();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setRateLimitStoreForTests();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
});

async function repeat<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(await fn(i));
  return out;
}

describe("sign-in limits (F6 order: ip, then email+ip, then email)", () => {
  it("checks the IP bucket first, then (email, IP), then email", async () => {
    await signInAction(signInForm());
    expect(store.calls).toEqual([
      { limit: 20, windowSec: 300 },
      { limit: 10, windowSec: 900 },
      { limit: 50, windowSec: 3600 },
    ]);
  });

  it("allows 10 tries per (email, IP), then refuses without calling Supabase", async () => {
    const replies = await repeat(10, () => signInAction(signInForm()));
    for (const r of replies) expect(r).toEqual({ error: "Invalid email or password" });

    const over = await signInAction(signInForm());
    expect(over).toEqual({ error: RATE_LIMITED_MESSAGE, retryAfterSec: 3600 });
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(10);
  });

  it("limits one IP to 20 sign-ins per 5 minutes across emails; other IPs are unaffected", async () => {
    await repeat(20, (i) => signInAction(signInForm(`user${i}@example.test`)));
    expect((await signInAction(signInForm("another@example.test"))).error).toBe(RATE_LIMITED_MESSAGE);

    fromIp("198.51.100.1");
    expect((await signInAction(signInForm("another@example.test"))).error).toBe("Invalid email or password");
  });

  it("limits one email to 50 per hour across many IPs (distributed guessing)", async () => {
    await repeat(50, (i) => {
      fromIp(`10.0.${Math.floor(i / 5)}.${i % 5}`);
      return signInAction(signInForm());
    });
    fromIp("192.0.2.200");
    expect((await signInAction(signInForm())).error).toBe(RATE_LIMITED_MESSAGE);
  });

  it("counts the email case- and space-insensitively", async () => {
    await repeat(10, (i) => signInAction(signInForm(i % 2 ? "Victim@Example.TEST" : "victim@example.test")));
    expect((await signInAction(signInForm("VICTIM@example.test"))).error).toBe(RATE_LIMITED_MESSAGE);
  });

  it("ignores spoofed X-Forwarded-For when the configured header is x-real-ip (F1)", async () => {
    await repeat(20, (i) => {
      fromIp("203.0.113.7", { "x-forwarded-for": `1.2.3.${i}` });
      return signInAction(signInForm(`user${i}@example.test`));
    });
    fromIp("203.0.113.7", { "x-forwarded-for": "9.9.9.9" });
    expect((await signInAction(signInForm("fresh@example.test"))).error).toBe(RATE_LIMITED_MESSAGE);
  });

  it("puts garbage or missing client IPs in one shared bucket (F1)", async () => {
    await repeat(20, (i) => {
      mocks.requestHeaders = new Headers(i % 2 ? { "x-real-ip": `not-an-ip-${i}` } : {});
      return signInAction(signInForm(`user${i}@example.test`));
    });
    mocks.requestHeaders = new Headers({ "x-real-ip": "1.2.3.4, 5.6.7.8" });
    expect((await signInAction(signInForm("fresh@example.test"))).error).toBe(RATE_LIMITED_MESSAGE);
    expect(warnSpy).toHaveBeenCalled();
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("not-an-ip");
  });

  it("rejects emails over 254 characters before touching the limiter (F10)", async () => {
    const long = `${"a".repeat(250)}@example.test`;
    expect((await signInAction(signInForm(long))).error).toBe("Enter a valid email");
    expect(store.calls).toEqual([]);
  });
});

describe("sign-up limits", () => {
  it("counts the username bucket first, then sign-up per IP and per email", async () => {
    await signUpAction(signUpForm("new@example.test"));
    expect(store.calls).toEqual([
      { limit: 20, windowSec: 600 }, // username-check, ip
      { limit: 10, windowSec: 3600 }, // sign-up, ip
      { limit: 3, windowSec: 3600 }, // sign-up, email
    ]);
  });

  it("a taken username uses only the username bucket", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await signUpAction(signUpForm("new@example.test"))).toEqual({ error: "That username is already taken" });
    expect(store.calls).toEqual([{ limit: 20, windowSec: 600 }]);
  });

  it("limits username checks to 20 per 10 minutes per IP", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await repeat(20, (i) => signUpAction(signUpForm("new@example.test", `taken_${i}`)));
    expect(await signUpAction(signUpForm("new@example.test", "taken_x"))).toEqual({
      error: RATE_LIMITED_MESSAGE,
      retryAfterSec: 600,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(20);
  });

  it("limits one IP to 10 sign-ups per hour", async () => {
    await repeat(10, (i) => signUpAction(signUpForm(`p${i}@example.test`)));
    expect(await signUpAction(signUpForm("p10@example.test"))).toEqual({
      error: RATE_LIMITED_MESSAGE,
      retryAfterSec: 3600,
    });
    expect(mocks.signUp).toHaveBeenCalledTimes(10);
  });

  it("gives byte-identical replies for registered and new emails, under and over the limit", async () => {
    const existing = "taken@example.test";
    const fresh = "fresh@example.test";
    const replyFor = async (email: string) => {
      mocks.signUp.mockResolvedValueOnce(
        email === existing
          ? { data: { session: null, user: null }, error: { code: "user_already_exists", message: "User already registered" } }
          : { data: { session: null, user: {} }, error: null },
      );
      return JSON.stringify(await signUpAction(signUpForm(email)));
    };

    // Under the limit (3 per email per hour).
    for (let i = 0; i < 3; i++) expect(await replyFor(existing)).toBe(await replyFor(fresh));
    // Over the limit: the same refusal for both.
    const overExisting = await replyFor(existing);
    const overFresh = await replyFor(fresh);
    expect(overExisting).toBe(overFresh);
    expect(JSON.parse(overFresh)).toEqual({ error: RATE_LIMITED_MESSAGE, retryAfterSec: 3600 });
  });

  it("applies the sign-up limit before the local store in local mode", async () => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "local");
    mocks.updateStore.mockImplementation(async () => {
      throw new Error("stop after the limiter");
    });
    await repeat(3, () => signUpAction(signUpForm("local@example.test")).catch(() => undefined));
    expect(mocks.updateStore).toHaveBeenCalledTimes(3);

    expect((await signUpAction(signUpForm("local@example.test"))).error).toBe(RATE_LIMITED_MESSAGE);
    expect(mocks.updateStore).toHaveBeenCalledTimes(3);
  });
});

describe("failing closed (F9/F10)", () => {
  const broken: RateLimitStore = {
    hit: async () => {
      throw new Error("database is down");
    },
  };

  it("refuses sign-in and sign-up with a generic message when the store errors", async () => {
    setRateLimitStoreForTests(broken);
    expect(await signInAction(signInForm())).toEqual({ error: RATE_LIMIT_UNAVAILABLE_MESSAGE });
    expect(await signUpAction(signUpForm("new@example.test"))).toEqual({ error: RATE_LIMIT_UNAVAILABLE_MESSAGE });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses when the store hangs past the timeout", async () => {
    setRateLimitStoreForTests({ hit: () => new Promise(() => {}) }, 20);
    expect(await signInAction(signInForm())).toEqual({ error: RATE_LIMIT_UNAVAILABLE_MESSAGE });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("never limits sign-out", async () => {
    setRateLimitStoreForTests(broken);
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT /");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
});
