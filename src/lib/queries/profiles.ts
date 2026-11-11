import "server-only";

import { cache } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";

export { toPublicProfile } from "@/lib/data/profiles";

/** The signed-in user's own profile (username, display name, bio). */
export async function getOwnProfile() {
  const user = await requireUser();
  return getRepository().getOwnProfile(user.id);
}

/**
 * Profile page for /u/[username]. Deduped per request so generateMetadata
 * and the page share one read. The viewer id comes from the session, never
 * from the URL.
 */
export const getUserProfile = cache(async (username: string) => {
  const viewerId = (await getSessionUser())?.id ?? null;
  return getRepository().getUserProfile(viewerId, username);
});
