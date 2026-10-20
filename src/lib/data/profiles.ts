import type { PublicProfile } from "@/lib/types";

type ProfileSource = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

/**
 * Another user's profile as returned to the UI (friends, search, deck owners).
 * Picks fields explicitly so a LocalUser's email/passwordHash/bio can never
 * ride along. Only the caller's own SessionUser carries an email.
 */
export function toPublicProfile(user: ProfileSource): PublicProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}
