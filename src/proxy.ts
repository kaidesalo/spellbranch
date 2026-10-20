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
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff|woff2)$).*)",
  ],
};
