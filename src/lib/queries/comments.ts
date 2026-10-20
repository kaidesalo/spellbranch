import "server-only";

import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";

export async function listComments(deckId: string) {
  const user = await getSessionUser();
  return getRepository().listComments(user?.id ?? null, deckId);
}
