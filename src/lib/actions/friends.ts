"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { requireUser } from "@/lib/auth/require-user";
import { readStore, updateStore } from "@/lib/data/store";
import { toPublicProfile } from "@/lib/queries/profiles";

export type ActionResult = { error?: string; success?: boolean };

export async function searchUsersAction(query: string) {
  const user = await requireUser();
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const store = await readStore();
  return store.users
    .filter(
      (u) =>
        u.id !== user.id &&
        (u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)),
    )
    .slice(0, 12)
    .map(toPublicProfile);
}

export async function sendFriendRequestAction(
  addresseeId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  if (addresseeId === user.id) {
    return { error: "You cannot friend yourself" };
  }

  try {
    await updateStore((store) => {
      const target = store.users.find((u) => u.id === addresseeId);
      if (!target) throw new Error("User not found");

      const existing = store.friendships.find(
        (f) =>
          (f.requesterId === user.id && f.addresseeId === addresseeId) ||
          (f.requesterId === addresseeId && f.addresseeId === user.id),
      );

      if (existing?.status === "accepted") {
        throw new Error("You are already friends");
      }
      if (existing?.status === "pending") {
        throw new Error("A friend request already exists");
      }

      if (existing) {
        existing.status = "pending";
        existing.requesterId = user.id;
        existing.addresseeId = addresseeId;
        existing.createdAt = new Date().toISOString();
      } else {
        store.friendships.push({
          id: uuidv4(),
          requesterId: user.id,
          addresseeId,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
      }
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not send request",
    };
  }

  revalidatePath("/friends");
  return { success: true };
}

export async function respondFriendRequestAction(
  friendshipId: string,
  accept: boolean,
): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await updateStore((store) => {
      const friendship = store.friendships.find((f) => f.id === friendshipId);
      if (!friendship || friendship.addresseeId !== user.id) {
        throw new Error("Friend request not found");
      }
      friendship.status = accept ? "accepted" : "declined";
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update request",
    };
  }

  revalidatePath("/friends");
  return { success: true };
}

export async function removeFriendAction(
  friendshipId: string,
): Promise<ActionResult> {
  const user = await requireUser();

  await updateStore((store) => {
    store.friendships = store.friendships.filter((f) => {
      if (f.id !== friendshipId) return true;
      return !(f.requesterId === user.id || f.addresseeId === user.id);
    });
  });

  revalidatePath("/friends");
  return { success: true };
}
