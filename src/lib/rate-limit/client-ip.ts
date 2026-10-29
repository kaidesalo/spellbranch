import "server-only";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

/**
 * The client's IP, as a rate-limit bucket name (review M1, Cipher F1/F2).
 *
 * We read exactly ONE header, named by SPELLBRANCH_CLIENT_IP_HEADER, which the
 * hosting platform sets and overwrites (see README "Client IP header"). We
 * never parse X-Forwarded-For ourselves: anything a client can send, it can
 * spoof.
 *
 * Results:
 *   "1.2.3.4"                    an IPv4 client (IPv4-mapped IPv6 is unmapped first)
 *   "v6:20010db800010002/64"     an IPv6 client, grouped by its /64 network
 *   "unknown"                    header missing, a list, or not one valid IP.
 *                                Everyone in this state shares ONE bucket, so a
 *                                misrouted request can't mint fresh buckets.
 *   "local"                      dev only, when no header is configured
 */

type Env = Record<string, string | undefined>;
type HeaderReader = Pick<Headers, "get">;

export const UNKNOWN_IP = "unknown";
export const LOCAL_IP = "local";

/** The configured header name (lower case), or null when unset. */
export function clientIpHeaderName(env: Env = process.env): string | null {
  const name = env.SPELLBRANCH_CLIENT_IP_HEADER?.trim().toLowerCase();
  return name ? name : null;
}

export function getClientIp(headers: HeaderReader, env: Env = process.env): string {
  const name = clientIpHeaderName(env);
  if (!name) {
    // Production refuses to start without the header name (assertRateLimitConfig).
    return env.NODE_ENV === "production" ? UNKNOWN_IP : LOCAL_IP;
  }

  const raw = headers.get(name)?.trim();
  // isIP() rejects comma lists, "127.1", ports and empty strings. A "%zone"
  // suffix (fe80::1%eth0) never comes from the internet, so refuse it too.
  if (!raw || isIP(raw) === 0 || raw.includes("%")) {
    warnUnknownIp(name);
    return UNKNOWN_IP;
  }
  try {
    return ipBucket(raw);
  } catch {
    // ipaddr.js rejects a few forms isIP() accepts, such as ::1.2.3.4 and
    // 64:ff9b::1.2.3.4 (Cipher R1). This runs before limit()'s try/catch, so
    // an exception here would be a 500; it's just "not one usable IP".
    warnUnknownIp(name);
    return UNKNOWN_IP;
  }
}

/** Canonical bucket name for one valid IP string. */
export function ipBucket(raw: string): string {
  const address = ipaddr.process(raw); // turns ::ffff:a.b.c.d into IPv4
  if (address.kind() === "ipv4") return address.toString();
  const first64Bits = address.toByteArray().slice(0, 8);
  return `v6:${Buffer.from(first64Bits).toString("hex")}/64`;
}

// Log at most once a minute, and never the header's value.
let lastWarning = 0;
function warnUnknownIp(headerName: string) {
  const now = Date.now();
  if (now - lastWarning < 60_000) return;
  lastWarning = now;
  console.warn(
    `[spellbranch] rate limit: request without one valid IP in "${headerName}"; using the shared "unknown" bucket`,
  );
}
