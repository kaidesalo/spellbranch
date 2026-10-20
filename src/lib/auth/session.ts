import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "@/lib/types";
import { readStore } from "@/lib/data/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Local backend: HS256 JWT in an httpOnly cookie, users in .data/store.json
// ---------------------------------------------------------------------------

const COOKIE_NAME = "spellbranch_session";
const SESSION_DAYS = 14;
const DEV_ONLY_SECRET = "spellbranch-local-dev-secret-change-me";

let warnedAboutDevSecret = false;

export function resolveAuthSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.AUTH_SECRET?.trim();
  if (secret) return secret;

  if (env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is required in production for the local auth backend. Set it to a long random string (e.g. `openssl rand -base64 32`).",
    );
  }

  if (!warnedAboutDevSecret) {
    warnedAboutDevSecret = true;
    console.warn(
      "[spellbranch] AUTH_SECRET is not set; using an insecure dev-only secret. Set AUTH_SECRET in .env.local.",
    );
  }
  return DEV_ONLY_SECRET;
}

function getSecret() {
  return new TextEncoder().encode(resolveAuthSecret());
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionUser | null> {
  // Resolve outside the try so a missing production secret fails loudly
  // instead of looking like an invalid token.
  const secret = getSecret();
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.id !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.displayName !== "string"
    ) {
      return null;
    }
    return {
      id: payload.id,
      email: payload.email,
      username: payload.username,
      displayName: payload.displayName,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser) {
  const token = await createSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

async function getLocalSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;

  const store = await readStore();
  const user = store.users.find((u) => u.id === session.id);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
  };
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

/**
 * Identity comes only from supabase.auth.getClaims(), which verifies the JWT
 * (never from getSession(), which trusts the cookie as-is). Profile fields come
 * from public.profiles (RLS: authenticated users may read profiles).
 */
async function getSupabaseSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .eq("id", claims.sub)
    .maybeSingle();

  if (profileError || !profile) {
    if (profileError) {
      console.error("[spellbranch] could not load profile:", profileError.message);
    }
    return null;
  }

  return {
    id: profile.id as string,
    email: typeof claims.email === "string" ? claims.email : "",
    username: profile.username as string,
    displayName: profile.display_name as string,
  };
}

export async function getSupabaseProfileBio(userId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("bio")
    .eq("id", userId)
    .maybeSingle();
  return (data?.bio as string | undefined) ?? "";
}

// ---------------------------------------------------------------------------

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isSupabaseConfigured()) return getSupabaseSessionUser();
  return getLocalSessionUser();
}

export { COOKIE_NAME };
