import "server-only";

import { requireUser } from "@/lib/auth/require-user";
import { getRepository } from "@/lib/data";

export async function getFriendsData() {
  const user = await requireUser();
  return getRepository().getFriendsData(user.id);
}
