"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/require-user";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session";
import { updateStore } from "@/lib/data/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { checkUsernameAvailable } from "@/lib/supabase/username";

/** Keep in sync with supabase/config.toml `minimum_password_length`. */
const MIN_PASSWORD_LENGTH = 8;

const signUpSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(72, "Password must be 72 characters or fewer"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only use letters, numbers, and _")
    .optional(),
  displayName: z.string().min(1).max(48).optional(),
});

// Sign-in deliberately doesn't enforce the sign-up length rule, so accounts
// created under the old 6-character minimum can still log in.
const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

/**
 * L2: what sign-up returns when Supabase needs email confirmation, and ALSO
 * when the email is already registered, so the form can't be used to check
 * which addresses have accounts.
 */
const SIGN_UP_CHECK_EMAIL: AuthResult = {
  success: true,
  message: "Check your email to confirm your account.",
};

export type AuthResult = { error?: string; success?: boolean; message?: string };

export async function signUpAction(formData: FormData): Promise<AuthResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    username: formData.get("username"),
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { email, password, username, displayName } = parsed.data;
  if (!username) return { error: "Username is required" };

  if (isSupabaseConfigured()) {
    const result = await supabaseSignUp({
      email,
      password,
      username,
      displayName: displayName || username,
    });
    if (result !== "signed-in") return result;
    redirect("/dashboard");
  }

  try {
    const user = await updateStore((store) => {
      if (store.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
        throw new Error("An account with this email already exists");
      }
      if (
        store.users.some(
          (u) => u.username.toLowerCase() === username.toLowerCase(),
        )
      ) {
        throw new Error("That username is already taken");
      }

      const now = new Date().toISOString();
      const created = {
        id: uuidv4(),
        email: email.toLowerCase(),
        username,
        displayName: displayName || username,
        bio: "",
        avatarUrl: null,
        passwordHash: hashPassword(password),
        createdAt: now,
      };
      store.users.push(created);
      return created;
    });

    await setSessionCookie({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create account",
    };
  }

  redirect("/dashboard");
}

export async function signInAction(formData: FormData): Promise<AuthResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { email, password } = parsed.data;

  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.code === "email_not_confirmed") {
        return { error: "Please confirm your email address first (check your inbox)." };
      }
      return { error: "Invalid email or password" };
    }
    redirect("/dashboard");
  }

  try {
    const user = await updateStore((store) => {
      const found = store.users.find(
        (u) => u.email.toLowerCase() === email.toLowerCase(),
      );
      if (!found || !verifyPassword(password, found.passwordHash)) {
        throw new Error("Invalid email or password");
      }
      return found;
    });

    await setSessionCookie({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not sign in",
    };
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  await clearSessionCookie();
  redirect("/");
}

export async function updateProfileAction(
  formData: FormData,
): Promise<AuthResult> {
  const user = await requireUser();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();

  if (!displayName || displayName.length > 48) {
    return { error: "Display name must be 1–48 characters" };
  }
  if (bio.length > 280) {
    return { error: "Bio must be 280 characters or fewer" };
  }

  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, bio })
      .eq("id", user.id);
    if (error) return { error: "Could not update profile" };
    return { success: true };
  }

  await updateStore((store) => {
    const profile = store.users.find((u) => u.id === user.id);
    if (!profile) throw new Error("Profile not found");
    profile.displayName = displayName;
    profile.bio = bio;
  });

  await setSessionCookie({
    ...user,
    displayName,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Supabase sign-up
// ---------------------------------------------------------------------------

async function supabaseSignUp(input: {
  email: string;
  password: string;
  username: string;
  displayName: string;
}): Promise<AuthResult | "signed-in"> {
  const supabase = await createSupabaseServerClient();

  // Friendly pre-check via the username_available RPC (anon-callable). If it
  // can't be verified we stop rather than assume "available"; the unique
  // index in the database still settles two sign-ups racing for one name.
  const availability = await checkUsernameAvailable(supabase, input.username);
  if (availability === "error") {
    return { error: "Could not create account right now. Please try again." };
  }
  if (availability === "taken") return { error: "That username is already taken" };

  const siteUrl = process.env.SPELLBRANCH_SITE_URL?.replace(/\/+$/, "");
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { username: input.username, display_name: input.displayName },
      ...(siteUrl ? { emailRedirectTo: `${siteUrl}/auth/confirm?next=/dashboard` } : {}),
    },
  });

  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      // Only reachable with confirmations OFF. Answer exactly like a fresh
      // sign-up so the response doesn't reveal that the email is registered.
      return { ...SIGN_UP_CHECK_EMAIL };
    }
    if (error.code === "weak_password") {
      return { error: error.message || "Password is too weak" };
    }
    console.error("[spellbranch] sign-up failed:", error.code ?? error.message);
    return { error: "Could not create account" };
  }

  if (data.session) return "signed-in";

  // Email confirmation is on: no session until the link in the email is used.
  // (Supabase also returns this, without an error, for an already-registered
  // email so the form can't be used to probe which emails have accounts.)
  return { ...SIGN_UP_CHECK_EMAIL };
}
