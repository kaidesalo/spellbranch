import "server-only";

import { requireUser } from "@/lib/auth/require-user";
import { getRepository } from "@/lib/data";

export { toPublicProfile } from "@/lib/data/profiles";

/** The signed-in user's own profile (username, display name, bio). */
export async function getOwnProfile() {
  const user = await requireUser();
  return getRepository().getOwnProfile(user.id);
}
