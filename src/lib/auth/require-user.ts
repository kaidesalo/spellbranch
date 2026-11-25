import "server-only";

import { redirect } from "next/navigation";
import { getSessionLoad } from "@/lib/auth/session";

/**
 * Returns the signed-in user or redirects to /login.
 *
 * Lives in a server-only module (not a "use server" file) so it is never
 * exposed as a callable server action. Pages and actions import it from here.
 *
 * A verified session whose profile row cannot be read is not the same as
 * being signed out. /login?error=profile lets that page say why.
 */
export async function requireUser() {
  const loaded = await getSessionLoad();
  if (loaded.status === "ready") return loaded.user;
  if (loaded.status === "profile-unavailable") redirect("/login?error=profile");
  redirect("/login");
}
