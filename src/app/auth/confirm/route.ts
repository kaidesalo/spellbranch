import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Email confirmation landing route.
 *
 * Supports the token-hash link recommended for SSR
 *   /auth/confirm?token_hash=...&type=email&next=/dashboard
 * and the PKCE redirect (?code=...) Supabase uses when emailRedirectTo points here.
 * `next` is only honoured if it is a same-origin relative path.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"), "/dashboard");

  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");

  let ok = false;
  const supabase = await createClient();

  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  // redirect() must be called outside try/catch; it throws NEXT_REDIRECT.
  if (!ok) redirect("/login?error=confirm");
  redirect(next);
}
