import "server-only";

import { getSessionUser } from "@/lib/auth/session";
import { readStore } from "@/lib/data/store";
import { canViewDeck } from "@/lib/permissions";

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

