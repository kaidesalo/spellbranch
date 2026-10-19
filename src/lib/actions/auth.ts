"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  clearSessionCookie,
  getSessionUser,
  setSessionCookie,
} from "@/lib/auth/session";
import { updateStore } from "@/lib/data/store";

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only use letters, numbers, and _")
    .optional(),
  displayName: z.string().min(1).max(48).optional(),
});

export type AuthResult = { error?: string; success?: boolean };

export async function signUpAction(formData: FormData): Promise<AuthResult> {
  const parsed = credentialsSchema.safeParse({
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
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { email, password } = parsed.data;

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
  await clearSessionCookie();
  redirect("/");
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
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
