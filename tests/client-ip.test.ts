import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientIp, ipBucket } from "@/lib/rate-limit/client-ip";
import { assertRateLimitConfig } from "@/lib/rate-limit/config";

// Review M1, Cipher F1/F2: one configured header, exactly one valid IP,
// otherwise the shared "unknown" bucket; IPv4-mapped unmapped; IPv6 by /64.

const VERCEL = { SPELLBRANCH_CLIENT_IP_HEADER: "x-real-ip" };

function h(values: Record<string, string>) {
  return new Headers(values);
}

describe("getClientIp", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads only the configured header", () => {
    expect(getClientIp(h({ "x-real-ip": "203.0.113.7" }), VERCEL)).toBe("203.0.113.7");
  });

  it("treats the env var case-insensitively and trims the value", () => {
    const env = { SPELLBRANCH_CLIENT_IP_HEADER: " X-Real-IP " };
    expect(getClientIp(h({ "x-real-ip": " 203.0.113.7 " }), env)).toBe("203.0.113.7");
  });

  it("ignores X-Forwarded-For and other headers", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const headers = h({ "x-forwarded-for": "198.51.100.1", "cf-connecting-ip": "198.51.100.2" });
    expect(getClientIp(headers, VERCEL)).toBe("unknown");
  });

  it.each([
    ["missing", {}],
    ["empty", { "x-real-ip": "" }],
    ["a comma list", { "x-real-ip": "1.2.3.4, 5.6.7.8" }],
    ["a short-form IPv4", { "x-real-ip": "127.1" }],
    ["with a port", { "x-real-ip": "1.2.3.4:5678" }],
    ["garbage", { "x-real-ip": "not-an-ip" }],
    // isIP() accepts these but ipaddr.js throws on them (Cipher R1).
    ["IPv4-compatible IPv6", { "x-real-ip": "::1.2.3.4" }],
    ["NAT64 with embedded IPv4", { "x-real-ip": "64:ff9b::1.2.3.4" }],
    ["with a zone suffix", { "x-real-ip": "fe80::1%eth0" }],
  ])("gives the shared unknown bucket when the header is %s", (_label, values) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getClientIp(h(values), VERCEL)).toBe("unknown");
    expect(getClientIp(h(values), { ...VERCEL, NODE_ENV: "production" })).toBe("unknown");
  });

  it("never logs the header value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getClientIp(h({ "x-real-ip": "secret-looking-value" }), VERCEL);
    for (const call of warn.mock.calls) expect(call.join(" ")).not.toContain("secret-looking-value");
  });

  it('uses "local" in dev when no header is configured, never in production', () => {
    expect(getClientIp(h({ "x-real-ip": "1.2.3.4" }), {})).toBe("local");
    expect(getClientIp(h({ "x-real-ip": "1.2.3.4" }), { NODE_ENV: "production" })).toBe("unknown");
  });
});

describe("ipBucket", () => {
  it("unmaps IPv4-mapped IPv6", () => {
    expect(ipBucket("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("groups IPv6 by /64, whatever the spelling", () => {
    const a = ipBucket("2001:db8:1:2:aaaa::1");
    expect(a).toBe("v6:20010db800010002/64");
    expect(ipBucket("2001:0DB8:1:2::ffff")).toBe(a);
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(a);
  });
});

describe("assertRateLimitConfig (production)", () => {
  const secret = "x".repeat(44);

  it("throws when SPELLBRANCH_CLIENT_IP_HEADER is unset", () => {
    expect(() => assertRateLimitConfig({ SPELLBRANCH_RATE_LIMIT_SECRET: secret })).toThrow(
      /SPELLBRANCH_CLIENT_IP_HEADER/,
    );
  });

  it("passes with a header name and a good secret", () => {
    expect(() =>
      assertRateLimitConfig({ SPELLBRANCH_RATE_LIMIT_SECRET: secret, ...VERCEL }),
    ).not.toThrow();
  });
});
