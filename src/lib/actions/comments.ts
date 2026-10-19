"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { requireUser } from "@/lib/actions/auth";
import { getSessionUser } from "@/lib/auth/session";
import { readStore, updateStore } from "@/lib/data/store";
import { canCommentOnDeck, canViewDeck } from "@/lib/permissions";

export type ActionResult = { error?: string; success?: boolean };

export async function listComments(deckId: string) {
  const user = await getSessionUser();
  const store = await readStore();
  const deck = store.decks.find((d) => d.id === deckId);
  if (!deck || !canViewDeck(store, deck, user?.id ?? null)) {
    return [];
  }

  return store.comments
    .filter((c) => c.deckId === deckId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => {
      const author = store.users.find((u) => u.id === c.authorId);
      return {
        ...c,
        author: author
          ? {
              id: author.id,
              username: author.username,
              displayName: author.displayName,
            }
          : null,
      };
    });
}

export async function addCommentAction(
  deckId: string,
  body: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return { error: "Comment cannot be empty" };
  if (text.length > 1000) return { error: "Comment is too long" };

  try {
    await updateStore((store) => {
      const deck = store.decks.find((d) => d.id === deckId);
      if (!deck || !canCommentOnDeck(store, deck, user.id)) {
        throw new Error("You cannot comment on this deck");
      }
      store.comments.push({
        id: uuidv4(),
        deckId,
        authorId: user.id,
        body: text,
        createdAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not post comment",
    };
  }

  revalidatePath(`/decks/${deckId}`);
  return { success: true };
}
