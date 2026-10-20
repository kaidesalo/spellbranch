"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import type { PublicProfile } from "@/lib/types";

export type ActionResult = { error?: string; success?: boolean };

/**
 * Exact, case-insensitive username lookup (Supabase: rpc('find_profile')).
 * Returns 0 or 1 profiles (id, username, display name, avatar), never the
 * caller and never an email. No partial or display-name search.
 */
export async function findProfileAction(username: string): Promise<PublicProfile[]> {
  const user = await requireUser();
  if (typeof username !== "string" || !username.trim()) return [];
  try {
    return await getRepository().findProfile(user.id, username);
  } catch (err) {
    userMessage(err, "");
    return [];
  }
}

export async function sendFriendRequestAction(
  addresseeId: string,
): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await getRepository().sendFriendRequest(user.id, addresseeId);
  } catch (err) {
    return { error: userMessage(err, "Could not send request") };
  }

  revalidatePath("/friends");
  return { success: true };
}

/** Addressee only: accept or decline a pending request. */
export async function respondFriendRequestAction(
  friendshipId: string,
  accept: boolean,
): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await getRepository().respondFriendRequest(user.id, friendshipId, accept === true);
  } catch (err) {
    return { error: userMessage(err, "Could not update request") };
  }

  revalidatePath("/friends");
  return { success: true };
}

/** Cancel a pending request you sent, or unfriend. */
export async function removeFriendAction(
  friendshipId: string,
): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await getRepository().removeFriendship(user.id, friendshipId);
  } catch (err) {
    return { error: userMessage(err, "Could not remove") };
  }

  revalidatePath("/friends");
  return { success: true };
}
