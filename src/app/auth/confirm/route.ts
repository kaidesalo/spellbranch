import { NextResponse, type NextRequest } from "next/server";
import { isAllowedOrigin, isEmailOtpType, renderConfirmPage } from "@/lib/auth/confirm";
import { safeNextPath } from "@/lib/auth/redirect";
import { limit, limitMessage, type LimitResult } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/rate-limit/client-ip";
import { getSiteOrigin, isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Email confirmation.
 *
 * GET  /auth/confirm?token_hash=...&type=email&next=/dashboard
 *      Renders a page with a "Confirm" button. Does NOT call verifyOtp: a GET
 *      that consumes the token allows login CSRF and is "clicked" by mail
 *      scanners first.
 * POST /auth/confirm (form: token_hash, type, next)
 *      Origin must equal SPELLBRANCH_SITE_URL; then verifyOtp and redirect.
 * GET  /auth/confirm?code=...
 *      PKCE redirect. Safe on GET: the exchange needs the code_verifier cookie
 *      of the browser that started sign-up.
 *
 * `next` always goes through safeNextPath (same-origin relative paths only).
 *
 * Review M1: the POST (after the Origin check) and the ?code= exchange are
 * rate limited per client IP. Over the limit: 429 + Retry-After; limiter
 * unavailable: 503. Both with a plain generic body.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  // The URL carries token_hash; never send it in a cross-origin Referer.
  // Not "no-referrer": that makes browsers send `Origin: null` on the form
  // POST, which the Origin check rejects.
  "Referrer-Policy": "same-origin",
};

function redirectTo(request: NextRequest, path: string, status: 303 | 307 = 307) {
  const base = getSiteOrigin() ?? request.nextUrl.origin;
  const response = NextResponse.redirect(new URL(path, base), status);
  for (const [k, v] of Object.entries(PRIVATE_HEADERS)) response.headers.set(k, v);
  return response;
}

/** A plain-text refusal, or null when the attempt may go ahead. */
async function refuseIfLimited(request: NextRequest): Promise<NextResponse | null> {
  const result: LimitResult = await limit("confirm", { ip: getClientIp(request.headers) });
  if (result.ok) return null;
  const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", ...PRIVATE_HEADERS };
  if (result.reason === "limited") headers["Retry-After"] = String(result.retryAfterSec);
  return new NextResponse(limitMessage(result), {
    status: result.reason === "limited" ? 429 : 503,
    headers,
  });
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return redirectTo(request, "/login");

  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"), "/dashboard");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");

  if (tokenHash && isEmailOtpType(type)) {
    return new NextResponse(renderConfirmPage({ tokenHash, type, next }), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...PRIVATE_HEADERS },
    });
  }

  if (code) {
    const refused = await refuseIfLimited(request);
    if (refused) return refused;
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return redirectTo(request, error ? "/login?error=confirm" : next);
  }

  return redirectTo(request, "/login?error=confirm");
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) return redirectTo(request, "/login", 303);

  if (!isAllowedOrigin(request.headers, getSiteOrigin())) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...PRIVATE_HEADERS },
    });
  }

  const refused = await refuseIfLimited(request);
  if (refused) return refused;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectTo(request, "/login?error=confirm", 303);
  }

  const tokenHash = form.get("token_hash");
  const type = form.get("type");
  const nextRaw = form.get("next");
  const next = safeNextPath(typeof nextRaw === "string" ? nextRaw : null, "/dashboard");

  if (typeof tokenHash !== "string" || !tokenHash || !isEmailOtpType(type)) {
    return redirectTo(request, "/login?error=confirm", 303);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  // 303 so the browser follows with a GET.
  return redirectTo(request, error ? "/login?error=confirm" : next, 303);
}
