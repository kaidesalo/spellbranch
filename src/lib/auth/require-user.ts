import "server-only";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Returns the signed-in user or redirects to /login.
 *
 * Lives in a server-only module (not a "use server" file) so it is never
 * exposed as a callable server action. Pages and actions import it from here.
 */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
