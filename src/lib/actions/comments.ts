"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { check, commentBodySchema, idSchema } from "@/lib/actions/schemas";
import { limit, limitError, requestIp } from "@/lib/rate-limit";

export type ActionResult = { error?: string; success?: boolean; retryAfterSec?: number };

export async function addCommentAction(
  deckId: string,
  body: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "You cannot comment on this deck");
  if (!id.ok) return { error: id.error };
  const parsed = check(commentBodySchema, body, "Invalid comment");
  if (!parsed.ok) return { error: parsed.error };
  const text = parsed.data;

  const allowed = await limit("comment", { ip: await requestIp(), userId: user.id });
  if (!allowed.ok) return limitError(allowed);

  try {
    await getRepository().addComment(user.id, deckId, text);
  } catch (err) {
    return { error: userMessage(err, "Could not post comment") };
  }

  revalidatePath(`/decks/${deckId}`);
  return { success: true };
}
