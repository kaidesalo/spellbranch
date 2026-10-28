"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { FRIEND_MESSAGES } from "@/lib/data/friend-rules";
import { check, idSchema, usernameQuerySchema } from "@/lib/actions/schemas";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import { z } from "zod";
import type { PublicProfile } from "@/lib/types";

export type ActionResult = { error?: string; success?: boolean };

export type FindProfileResult = {
  profiles: PublicProfile[];
  error?: string;
  /** Set when the lookup was rate limited (review M1/I2). */
  retryAfterSec?: number;
};

/**
 * Exact, case-insensitive username lookup (Supabase: rpc('find_profile')).
 * Returns 0 or 1 profiles (id, username, display name, avatar), never the
 * caller and never an email. No partial or display-name search.
 *
 * Review M1/I2: rate limited per IP and per user (find-profile policy), with
 * a per-user database backstop in find_profile itself (migration 004).
 */
export async function findProfileAction(username: string): Promise<FindProfileResult> {
  const user = await requireUser();
  const q = check(usernameQuerySchema, username, "");
  if (!q.ok || !q.data.trim()) return { profiles: [] };

  const allowed = await limit("find-profile", { ip: await requestIp(), userId: user.id });
  if (!allowed.ok) return { profiles: [], ...limitError(allowed) };

  try {
    return { profiles: await getRepository().findProfile(user.id, q.data) };
  } catch (err) {
    return { profiles: [], error: userMessage(err, "Search failed. Please try again.") };
  }
}

export async function sendFriendRequestAction(
  addresseeId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, addresseeId, FRIEND_MESSAGES.notFound);
  if (!id.ok) return { error: id.error };

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
  const id = check(idSchema, friendshipId, FRIEND_MESSAGES.requestNotFound);
  if (!id.ok) return { error: id.error };
  const decision = check(z.boolean("Invalid request"), accept, "Invalid request");
  if (!decision.ok) return { error: decision.error };

  try {
    await getRepository().respondFriendRequest(user.id, friendshipId, decision.data);
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
  const id = check(idSchema, friendshipId, FRIEND_MESSAGES.requestNotFound);
  if (!id.ok) return { error: id.error };

  try {
    await getRepository().removeFriendship(user.id, friendshipId);
  } catch (err) {
    return { error: userMessage(err, "Could not remove") };
  }

  revalidatePath("/friends");
  return { success: true };
}
