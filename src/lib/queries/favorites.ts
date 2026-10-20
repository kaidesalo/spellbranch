import "server-only";

import { requireUser } from "@/lib/auth/require-user";
import { readStore } from "@/lib/data/store";

export async function listFavorites() {
  const user = await requireUser();
  const store = await readStore();
  return store.favorites
    .filter((f) => f.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function isFavorite(scryfallId: string) {
  const user = await requireUser();
  const store = await readStore();
  return store.favorites.some(
    (f) => f.userId === user.id && f.scryfallId === scryfallId,
  );
}
