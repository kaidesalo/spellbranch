"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { updateStore } from "@/lib/data/store";

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

  await updateStore((store) => {
    const exists = store.favorites.some(
      (f) => f.userId === user.id && f.scryfallId === parsed.data.scryfallId,
    );
    if (exists) return;
    store.favorites.push({
      id: uuidv4(),
      userId: user.id,
      scryfallId: parsed.data.scryfallId,
      cardName: parsed.data.cardName,
      imageUri: parsed.data.imageUri ?? null,
      manaCost: parsed.data.manaCost ?? null,
      typeLine: parsed.data.typeLine ?? null,
      createdAt: new Date().toISOString(),
    });
  });

  revalidatePath("/favorites");
  return { success: true };
}

export async function removeFavoriteAction(
  favoriteId: string,
): Promise<ActionResult> {
  const user = await requireUser();

  await updateStore((store) => {
    store.favorites = store.favorites.filter(
      (f) => !(f.id === favoriteId && f.userId === user.id),
    );
  });

  revalidatePath("/favorites");
  return { success: true };
}
