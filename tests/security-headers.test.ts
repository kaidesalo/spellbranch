import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { buildCsp, generateNonce, staticSecurityHeaders } from "@/lib/security/headers";
import nextConfig from "../next.config";

describe("L5 security headers", () => {
  it("next.config disables X-Powered-By and sets the static headers on every path", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const byKey = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Permissions-Policy"]).toMatch(/camera=\(\)/);
    // /auth/confirm overrides Referrer-Policy (token_hash in the URL), but
    // not with no-referrer, which would turn Origin into "null".
    const confirm = rules.find((r) => r.source === "/auth/confirm")!;
    expect(confirm.headers).toEqual([{ key: "Referrer-Policy", value: "same-origin" }]);
    expect(rules.indexOf(confirm)).toBeGreaterThan(rules.indexOf(all));
  });

  it("adds HSTS only in production", () => {
    const keys = (env: Record<string, string>) => staticSecurityHeaders(env).map((h) => h.key);
    expect(keys({ NODE_ENV: "production" })).toContain("Strict-Transport-Security");
    expect(keys({ NODE_ENV: "development" })).not.toContain("Strict-Transport-Security");
  });

  it("CSP: nonce + strict-dynamic scripts, no unsafe-inline/eval scripts in prod, Scryfall images, no framing", () => {
    const csp = buildCsp("abc123", { NODE_ENV: "production" });
    const directive = (name: string) =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(directive("img-src")).toContain("https://cards.scryfall.io");
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(csp).not.toMatch(/unsafe-eval/);
  });

  it("CSP allows eval and the HMR socket only in development", () => {
    const csp = buildCsp("n", { NODE_ENV: "development" });
    expect(csp).toMatch(/script-src [^;]*'unsafe-eval'/);
    expect(csp).toMatch(/connect-src 'self' ws: wss:/);
  });

  it("nonces are random base64", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });

  it("proxy sets the CSP on the response and forwards it + x-nonce to rendering", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(new NextRequest("http://localhost:3847/login"));
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    // NextResponse.next({ request: { headers } }) encodes overridden request headers.
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });
});
