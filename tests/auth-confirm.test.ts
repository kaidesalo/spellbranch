import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isAllowedOrigin, renderConfirmPage } from "@/lib/auth/confirm";

// L1: GET /auth/confirm?token_hash renders a button; only an
// Origin-checked POST calls verifyOtp.

const SITE = "http://localhost:3847";
const verifyOtp = vi.fn(async () => ({ data: {}, error: null as null | { message: string } }));
const exchangeCodeForSession = vi.fn(async () => ({ data: {}, error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

async function route() {
  return import("@/app/auth/confirm/route");
}

function get(query: string) {
  return new NextRequest(`${SITE}/auth/confirm?${query}`);
}

function post(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new NextRequest(`${SITE}/auth/confirm`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("/auth/confirm", () => {
  beforeEach(() => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test_only");
    vi.stubEnv("SPELLBRANCH_SITE_URL", SITE);
    verifyOtp.mockClear();
    exchangeCodeForSession.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("GET with token_hash", () => {
    it("renders a confirm form and does NOT call verifyOtp", async () => {
      const { GET } = await route();
      const res = await GET(get("token_hash=abc123&type=email&next=/decks/new"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
      const html = await res.text();
      expect(html).toContain('<form method="post" action="/auth/confirm">');
      expect(html).toContain('name="token_hash" value="abc123"');
      expect(html).toContain('name="type" value="email"');
      expect(html).toContain('name="next" value="/decks/new"');
      expect(html).toMatch(/<button type="submit">Confirm<\/button>/);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/\sstyle=/i);
      expect(verifyOtp).not.toHaveBeenCalled();
    });

    it("sanitizes next and escapes the token in the page", async () => {
      const { GET } = await route();
      const res = await GET(
        get(`token_hash=${encodeURIComponent('"><script>x</script>')}&type=email&next=//evil.test`),
      );
      const html = await res.text();
      expect(html).toContain('name="next" value="/dashboard"');
      expect(html).not.toContain("<script>x</script>");
      expect(html).toContain("&quot;&gt;&lt;script&gt;");
      expect(verifyOtp).not.toHaveBeenCalled();
    });

    it("rejects an unknown type without rendering the form", async () => {
      const { GET } = await route();
      const res = await GET(get("token_hash=abc&type=bogus"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`${SITE}/login?error=confirm`);
      expect(verifyOtp).not.toHaveBeenCalled();
    });
  });

  describe("GET with code (PKCE)", () => {
    it("still exchanges on GET and redirects to a safe next", async () => {
      const { GET } = await route();
      const res = await GET(get("code=pkce-code&next=https://evil.test"));
      expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
      expect(res.headers.get("location")).toBe(`${SITE}/dashboard`);
    });
  });

  describe("POST", () => {
    const fields = { token_hash: "abc123", type: "email", next: "/decks/new" };

    it("verifies the token with a same-origin Origin and 303-redirects to next", async () => {
      const { POST } = await route();
      const res = await POST(post(fields, { origin: SITE, "sec-fetch-site": "same-origin" }));
      expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc123", type: "email" });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`${SITE}/decks/new`);
    });

    it("sanitizes next on POST too", async () => {
      const { POST } = await route();
      const res = await POST(post({ ...fields, next: "/\\evil.test" }, { origin: SITE }));
      expect(res.headers.get("location")).toBe(`${SITE}/dashboard`);
    });

    it("sends failures to /login?error=confirm", async () => {
      verifyOtp.mockResolvedValueOnce({ data: {}, error: { message: "expired" } });
      const { POST } = await route();
      const res = await POST(post(fields, { origin: SITE }));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`${SITE}/login?error=confirm`);
    });

    it.each([
      ["a foreign Origin", { origin: "https://evil.example" }],
      ["no Origin", {}],
      ["Origin: null", { origin: "null" }],
      ["a different port", { origin: "http://localhost:9999" }],
      ["cross-site Sec-Fetch-Site", { origin: SITE, "sec-fetch-site": "cross-site" }],
    ])("rejects %s with 403 and never calls verifyOtp", async (_label, headers) => {
      const { POST } = await route();
      const res = await POST(post(fields, headers as Record<string, string>));
      expect(res.status).toBe(403);
      expect(verifyOtp).not.toHaveBeenCalled();
    });

    it("rejects a bad type even from the right origin", async () => {
      const { POST } = await route();
      const res = await POST(post({ ...fields, type: "bogus" }, { origin: SITE }));
      expect(res.headers.get("location")).toBe(`${SITE}/login?error=confirm`);
      expect(verifyOtp).not.toHaveBeenCalled();
    });
  });

  it("isAllowedOrigin fails closed without a configured site origin", () => {
    expect(isAllowedOrigin(new Headers({ origin: SITE }), null)).toBe(false);
    expect(isAllowedOrigin(new Headers({ origin: SITE }), SITE)).toBe(true);
  });

  it("renderConfirmPage has no scripts or inline style attributes", () => {
    const html = renderConfirmPage({ tokenHash: "t", type: "email", next: "/dashboard" });
    expect(html).not.toMatch(/<script|\son\w+=|\sstyle=/i);
  });
});
