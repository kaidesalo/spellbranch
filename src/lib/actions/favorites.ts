"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";

export type ActionResult = { error?: string; success?: boolean };

const favoriteSchema = z.object({
  scryfallId: z.string().min(1),
  cardName: z.string().min(1),
  imageUri: z.string().nullable().optional(),
  manaCost: z.string().nullable().optional(),
  typeLine: z.string().nullable().optional(),
});

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

  try {
    await getRepository().removeFavorite(user.id, favoriteId);
  } catch (err) {
    return { error: userMessage(err, "Could not remove favorite") };
  }

  revalidatePath("/favorites");
  return { success: true };
}
