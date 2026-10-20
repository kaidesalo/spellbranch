"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";

export type ActionResult = { error?: string; success?: boolean };

export async function addCommentAction(
  deckId: string,
  body: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return { error: "Comment cannot be empty" };
  if (text.length > 1000) return { error: "Comment is too long" };

  try {
    await getRepository().addComment(user.id, deckId, text);
  } catch (err) {
    return { error: userMessage(err, "Could not post comment") };
  }

  revalidatePath(`/decks/${deckId}`);
  return { success: true };
}
