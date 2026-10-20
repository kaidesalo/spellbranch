import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  SUPABASE_COOKIE_OPTIONS,
  buildSupabaseCookieOptions,
} from "@/lib/supabase/cookie-options";

// Fake project: nothing here ever reaches the network (fetch is stubbed).
const SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
const STORAGE_KEY = "sb-abcdefghijklmnop-auth-token";

function b64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function fakeJwt(expSecondsFromNow: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: "11111111-1111-1111-1111-111111111111",
      email: "self@example.test",
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + expSecondsFromNow,
      session_id: "22222222-2222-2222-2222-222222222222",
    }),
  );
  return `${header}.${payload}.c2ln`;
}

const user = {
  id: "11111111-1111-1111-1111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "self@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

/** An already-expired session cookie, so getClaims() triggers a refresh. */
function expiredSessionCookie() {
  const session = {
    access_token: fakeJwt(-60),
    refresh_token: "old-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 60,
    user,
  };
  return `base64-${b64url(JSON.stringify(session))}`;
}

function stubAuthFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/v1/token")) {
      return Response.json({
        access_token: fakeJwt(3600),
        refresh_token: "new-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      });
    }
    if (url.includes("/auth/v1/user")) return Response.json(user);
    return new Response("unexpected", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  // supabase-js builds a realtime client eagerly and needs a WebSocket
  // constructor (Node 22+ has one built in); it is never opened here.
  if (typeof globalThis.WebSocket === "undefined") {
    vi.stubGlobal("WebSocket", class FakeWebSocket {});
  }
  return fetchMock;
}

describe("SUPABASE_COOKIE_OPTIONS", () => {
  it("is HttpOnly, SameSite=Lax, Path=/", () => {
    expect(SUPABASE_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(Object.isFrozen(SUPABASE_COOKIE_OPTIONS)).toBe(true);
  });

  it("is Secure only in production", () => {
    expect(buildSupabaseCookieOptions({ NODE_ENV: "production" }).secure).toBe(true);
    expect(buildSupabaseCookieOptions({ NODE_ENV: "development" }).secure).toBe(false);
    expect(buildSupabaseCookieOptions({ NODE_ENV: "test" }).secure).toBe(false);
  });

  it("does not override the cookie name (keeps the default storage key)", () => {
    expect(SUPABASE_COOKIE_OPTIONS.name).toBeUndefined();
  });
});

describe("Supabase clients write auth cookies with the shared options", () => {
  beforeEach(() => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test_only");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock("next/headers");
  });

  it("proxy updateSession: refreshed cookies keep HttpOnly/SameSite/Path", async () => {
    const fetchMock = stubAuthFetch();
    const { updateSession } = await import("@/lib/supabase/proxy");

    const request = new NextRequest("http://localhost:3847/dashboard", {
      headers: { cookie: `${STORAGE_KEY}=${expiredSessionCookie()}` },
    });
    const response = await updateSession(request);

    expect(fetchMock).toHaveBeenCalled();
    const setCookie = response.headers.getSetCookie();
    const auth = setCookie.filter((c) => c.startsWith(STORAGE_KEY));
    expect(auth.length).toBeGreaterThan(0);
    for (const cookie of auth) {
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=lax/i);
      expect(cookie).toMatch(/;\s*Path=\//i);
      // NODE_ENV is "test" here, so no Secure flag.
      expect(cookie).not.toMatch(/;\s*Secure/i);
    }
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("server createClient: setAll forwards the merged options to cookies().set", async () => {
    stubAuthFetch();
    const set = vi.fn();
    const jar = [{ name: STORAGE_KEY, value: expiredSessionCookie() }];
    vi.doMock("next/headers", () => ({
      cookies: async () => ({ getAll: () => jar, set }),
    }));
    const { createClient } = await import("@/lib/supabase/server");

    const supabase = await createClient();
    await supabase.auth.getClaims();

    expect(set).toHaveBeenCalled();
    for (const [name, , options] of set.mock.calls) {
      expect(String(name).startsWith(STORAGE_KEY)).toBe(true);
      expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
    }
  });
});
