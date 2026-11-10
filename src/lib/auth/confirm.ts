import type { EmailOtpType } from "@supabase/supabase-js";

/** Email OTP types /auth/confirm accepts (verifyOtp with token_hash). */
export const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

export function isEmailOtpType(value: unknown): value is EmailOtpType {
  return typeof value === "string" && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * CSRF check for POST /auth/confirm.
 *
 * Browsers send `Origin` on every form POST, so we require it to equal the
 * configured site origin exactly. A missing, "null" or foreign Origin is
 * rejected, and so is a Sec-Fetch-Site other than same-origin when the
 * browser sends one.
 */
export function isAllowedOrigin(
  headers: Pick<Headers, "get">,
  siteOrigin: string | null,
): boolean {
  if (!siteOrigin) return false;
  const origin = headers.get("origin");
  if (!origin || origin !== siteOrigin) return false;
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The GET /auth/confirm page: a single button that POSTs the token back.
 * GET never consumes the token, so link scanners and cross-site
 * <img>/navigation requests can't sign anyone in (login CSRF).
 *
 * Plain HTML, no scripts and no inline style attributes (CSP-friendly). The
 * one <style> block is allowed by the app CSP's style-src.
 */
export function renderConfirmPage(input: {
  tokenHash: string;
  type: EmailOtpType;
  next: string;
}): string {
  const field = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Confirm your email · Spellbranch</title>
<style>
body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#10141F;color:#F4EBDD}
main{max-width:24rem;padding:2rem;border:1px solid #344158;border-radius:.75rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{color:#ABB7C9;margin:0 0 1.5rem}
button{font:inherit;padding:.6rem 1.25rem;border:0;border-radius:.5rem;background:#E8B76A;color:#10141F;cursor:pointer}
</style>
</head>
<body>
<main>
<h1>Confirm your email</h1>
<p>Press the button to finish confirming your Spellbranch account.</p>
<form method="post" action="/auth/confirm">
${field("token_hash", input.tokenHash)}
${field("type", input.type)}
${field("next", input.next)}
<button type="submit">Confirm</button>
</form>
</main>
</body>
</html>
`;
}
