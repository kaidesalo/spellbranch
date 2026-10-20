import type { NextRequest } from "next/server";
import { buildCsp, generateNonce } from "@/lib/security/headers";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Fresh nonce per request. Next.js reads the CSP from the *request* headers
  // during rendering and puts the nonce on its scripts; the browser enforces
  // the copy on the response.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  const response = await updateSession(request, {
    "x-nonce": nonce,
    "Content-Security-Policy": csp,
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's static chunks/image optimizer and the real
    // files in public/ (plus the favicon). Review R1: no blanket extension
    // rule, so an HTML 404 like /nope.png or /x.js still gets the CSP.
    // Adding a file to public/? List it here (tests/proxy-matcher.test.ts checks).
    "/((?!_next/static/|_next/image$|(?:favicon\\.ico|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg)$).*)",
  ],
};
