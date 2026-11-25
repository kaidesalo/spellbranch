import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "@/lib/types";
import { readStore } from "@/lib/data/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isMissingAvatarPresetColumn } from "@/lib/avatar-presets";
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
    avatarUrl: user.avatarUrl,
    avatarPreset: user.avatarPreset ?? null,
  };
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

/**
 * Shown when sign-in succeeded and the JWT verifies, but public.profiles
 * could not be read. The PostgREST text stays in the server log only.
 */
export const PROFILE_UNAVAILABLE_MESSAGE =
  "You're signed in, but your profile could not be loaded.";

export type SessionLoad =
  | { status: "anonymous" }
  | { status: "ready"; user: SessionUser }
  | { status: "profile-unavailable" };

type ProfileError = { message?: string } | null;

/** The bits of a server Supabase client this module actually calls. */
type SessionReader = {
  auth: {
    getClaims: () => Promise<{
      data: { claims?: Record<string, unknown> } | null;
      error: ProfileError;
    }>;
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: ProfileError }>;
      };
    };
  };
};

/**
 * Identity comes only from supabase.auth.getClaims(), which verifies the JWT
 * (never from getSession(), which trusts the cookie as-is). Profile fields come
 * from public.profiles (RLS: "Authenticated read related profiles").
 *
 * A verified JWT with no readable profile is not "signed out". Callers that
 * treat it as signed out bounce the browser back to /login with no message.
 */
export async function loadSupabaseSession(supabase: SessionReader): Promise<SessionLoad> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") return { status: "anonymous" };

  const columns = ["id, username, display_name, avatar_url, avatar_preset", "id, username, display_name, avatar_url"];
  type ProfileRead = {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    avatar_preset?: string | null;
  };
  let profile: ProfileRead | null = null;
  let profileError: ProfileError = null;
  for (const columnList of columns) {
    const res = await supabase.from("profiles").select(columnList).eq("id", claims.sub).maybeSingle();
    if (isMissingAvatarPresetColumn(res.error)) continue;
    profile = res.data as ProfileRead | null;
    profileError = res.error;
    break;
  }

  if (profileError || !profile) {
    // The message is a Postgres/PostgREST error ("permission denied for table
    // friendships"), not a token, email, or key.
    console.error(
      "[spellbranch] could not load profile:",
      profileError?.message ?? "no row for the signed-in user",
    );
    return { status: "profile-unavailable" };
  }

  return {
    status: "ready",
    user: {
      id: profile.id,
      email: typeof claims.email === "string" ? claims.email : "",
      username: profile.username,
      displayName: profile.display_name,
      avatarUrl: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
      avatarPreset: typeof profile.avatar_preset === "string" ? profile.avatar_preset : null,
    },
  };
}

/**
 * The username the signed-in user asked for at sign-up (Supabase mode only;
 * from the verified JWT's user_metadata). handle_new_user() may have added a
 * suffix if that name was taken by the time the account was created (review
 * N2); compare it with the profile's final username. Local mode never
 * changes the requested name, so this is null there.
 */
export async function getRequestedUsername(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const meta = data?.claims?.user_metadata as Record<string, unknown> | undefined;
  if (error || !meta || typeof meta.username !== "string") return null;
  return meta.username;
}

// ---------------------------------------------------------------------------

export async function getSessionLoad(): Promise<SessionLoad> {
  if (!isSupabaseConfigured()) {
    const user = await getLocalSessionUser();
    return user ? { status: "ready", user } : { status: "anonymous" };
  }
  // Supabase's filter-builder generics don't compare to SessionReader here.
  return loadSupabaseSession((await createSupabaseServerClient()) as unknown as SessionReader);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const loaded = await getSessionLoad();
  return loaded.status === "ready" ? loaded.user : null;
}

export { COOKIE_NAME };
