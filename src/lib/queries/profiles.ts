import "server-only";

import type { PublicProfile } from "@/lib/types";

type ProfileSource = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  createdAt: string;
};

/**
 * Another user's profile as returned to the UI (friends, search, deck owners).
 * Picks fields explicitly so a LocalUser's email/passwordHash can never ride
 * along. Only the caller's own SessionUser carries an email.
 */
export function toPublicProfile(user: ProfileSource): PublicProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}
