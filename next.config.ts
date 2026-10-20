import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Content-Security-Policy is per-request (nonce) and set in src/proxy.ts.
  async headers() {
    return [
      { source: "/:path*", headers: staticSecurityHeaders() },
      // The confirm link carries token_hash in its URL: never send it cross-origin.
      // "same-origin", not "no-referrer": with no-referrer Chrome sends
      // `Origin: null` on the form POST and the CSRF check rejects it.
      // (Later entries override earlier ones for the same key.)
      { source: "/auth/confirm", headers: [{ key: "Referrer-Policy", value: "same-origin" }] },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cards.scryfall.io",
      },
      {
        protocol: "https",
        hostname: "c1.scryfall.com",
      },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
