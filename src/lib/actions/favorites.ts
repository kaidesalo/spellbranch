"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { check, favoriteSchema, idSchema } from "@/lib/actions/schemas";

export type ActionResult = { error?: string; success?: boolean };

export async function addFavoriteAction(
  input: z.infer<typeof favoriteSchema>,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = favoriteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid card" };
  }

  try {
    await getRepository().addFavorite(user.id, {
      scryfallId: parsed.data.scryfallId,
      cardName: parsed.data.cardName,
      imageUri: parsed.data.imageUri ?? null,
      manaCost: parsed.data.manaCost ?? null,
      typeLine: parsed.data.typeLine ?? null,
    });
  } catch (err) {
    return { error: userMessage(err, "Could not save favorite") };
  }

  revalidatePath("/favorites");
  return { success: true };
}

export async function removeFavoriteAction(
  favoriteId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, favoriteId, "Favorite not found");
  if (!id.ok) return { error: id.error };

  try {
    await getRepository().removeFavorite(user.id, favoriteId);
  } catch (err) {
    return { error: userMessage(err, "Could not remove favorite") };
  }

  revalidatePath("/favorites");
  return { success: true };
}
