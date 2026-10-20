import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkUsernameAvailable } from "@/lib/supabase/username";

// --- Mocks for signUpAction (no network, no hosted project) ---------------

const rpc = vi.fn();
const signUp = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc, from, auth: { signUp } })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  clearSessionCookie: vi.fn(),
  getSessionUser: vi.fn(),
  setSessionCookie: vi.fn(),
}));

const updateStore = vi.fn();
vi.mock("@/lib/data/store", () => ({
  updateStore: (...args: unknown[]) => updateStore(...args),
}));

const { signUpAction } = await import("@/lib/actions/auth");

function form(username = "Felix_1") {
  const fd = new FormData();
  fd.set("email", "felix@example.test");
  fd.set("password", "hunter22");
  fd.set("username", username);
  fd.set("displayName", "Felix");
  return fd;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rpc.mockReset();
  signUp.mockReset();
  from.mockReset();
  updateStore.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
});

// --- checkUsernameAvailable -----------------------------------------------

describe("checkUsernameAvailable", () => {
  it("calls the username_available RPC with { candidate }", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await checkUsernameAvailable({ rpc }, "Felix_1");
    expect(rpc).toHaveBeenCalledWith("username_available", { candidate: "Felix_1" });
  });

  it("returns available when the RPC returns true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkUsernameAvailable({ rpc }, "felix")).toBe("available");
  });

  it("returns taken when the RPC returns false", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkUsernameAvailable({ rpc }, "felix")).toBe("taken");
  });

  it("returns error (never available) when the RPC returns an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect(await checkUsernameAvailable({ rpc }, "felix")).toBe("error");
  });

  it("returns error (never available) when the RPC returns error alongside data", async () => {
    rpc.mockResolvedValue({ data: true, error: { message: "boom" } });
    expect(await checkUsernameAvailable({ rpc }, "felix")).toBe("error");
  });

  it("returns error when the RPC throws", async () => {
    rpc.mockRejectedValue(new Error("fetch failed"));
    expect(await checkUsernameAvailable({ rpc }, "felix")).toBe("error");
  });

  it.each([[null], [undefined], ["true"], [1], [[{ id: "x" }]]])(
    "returns error for a non-boolean payload %j",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      expect(await checkUsernameAvailable({ rpc }, "felix")).toBe("error");
    },
  );
});

// --- signUpAction (Supabase backend) --------------------------------------

describe("signUpAction with SPELLBRANCH_BACKEND=supabase", () => {
  beforeEach(() => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://unit-test.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_unit_test");
    vi.stubEnv("SPELLBRANCH_SITE_URL", "http://localhost:3847");
  });

  it("uses the RPC, not a public_profiles lookup", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    await signUpAction(form("Felix_1"));
    expect(rpc).toHaveBeenCalledWith("username_available", { candidate: "Felix_1" });
    expect(from).not.toHaveBeenCalled();
  });

  it("shows a generic error and does not sign up when the RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const result = await signUpAction(form());
    expect(result).toEqual({ error: "Could not create account right now. Please try again." });
    expect(result.error).not.toMatch(/permission|taken/i);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a taken username without calling signUp", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const result = await signUpAction(form());
    expect(result).toEqual({ error: "That username is already taken" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("calls signUp with the username when available", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    const result = await signUpAction(form("Felix_1"));
    expect(result).toMatchObject({ success: true });
    expect(signUp).toHaveBeenCalledOnce();
    expect(signUp.mock.calls[0][0].options.data).toEqual({
      username: "Felix_1",
      display_name: "Felix",
    });
  });

  it("redirects to /dashboard when signUp returns a session", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    signUp.mockResolvedValue({ data: { session: {} }, error: null });
    await expect(signUpAction(form())).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("never touches the local store", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await signUpAction(form());
    expect(updateStore).not.toHaveBeenCalled();
  });
});

describe("signUpAction with the local backend", () => {
  beforeEach(() => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "local");
  });

  it("uses the local store and never calls the RPC", async () => {
    updateStore.mockRejectedValue(new Error("That username is already taken"));
    const result = await signUpAction(form());
    expect(result).toEqual({ error: "That username is already taken" });
    expect(updateStore).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
  });
});
