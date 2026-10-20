/**
 * Security headers (L5).
 *
 * Static headers go on every response via next.config.ts `headers()`. The CSP
 * needs a fresh nonce per request, so src/proxy.ts builds it with buildCsp()
 * and Next.js stamps the nonce onto its own inline/bootstrap scripts (every
 * page is dynamic because the root layout reads the session cookie).
 */

type Env = Record<string, string | undefined>;

/** Hosts card images are loaded from (Scryfall). Images are `unoptimized`, so the browser fetches them directly. */
export const SCRYFALL_IMAGE_SOURCES = [
  "https://cards.scryfall.io",
  "https://*.scryfall.io",
  "https://*.scryfall.com",
] as const;

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildCsp(nonce: string, env: Env = process.env): string {
  const dev = env.NODE_ENV === "development";
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic': scripts loaded by the nonce'd Next.js bootstrap are
    // trusted; nothing else runs. React dev tooling needs eval in dev only.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Inline styles stay allowed: UI components and toasts set style
    // attributes, which nonces can't cover. Script injection is what matters.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...SCRYFALL_IMAGE_SOURCES],
    "font-src": ["'self'"],
    // The browser only talks to this origin (Scryfall and Supabase are called
    // from the server). Dev adds the HMR websocket.
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** Headers applied to every response from next.config.ts. */
export function staticSecurityHeaders(env: Env = process.env): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
  ];
  if (env.NODE_ENV === "production") {
    // Browsers ignore HSTS on plain-http localhost, so this is safe for `next start`.
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}
