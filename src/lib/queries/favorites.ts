import "server-only";

import { requireUser } from "@/lib/auth/require-user";
import { getRepository } from "@/lib/data";

export async function listFavorites() {
  const user = await requireUser();
  return getRepository().listFavorites(user.id);
}

export async function isFavorite(scryfallId: string) {
  return (await listFavorites()).some((f) => f.scryfallId === scryfallId);
}
