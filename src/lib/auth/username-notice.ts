/**
 * Review N2: if two sign-ups race for one username, the database keeps the
 * account but gives it a suffixed name (handle_new_user). Tell the user.
 * Returns null when there is nothing to say.
 */
export function usernameChangedNotice(
  requested: string | null | undefined,
  finalUsername: string,
): string | null {
  if (!requested) return null;
  if (requested.toLowerCase() === finalUsername.toLowerCase()) return null;
  return `@${requested} was taken by the time your account was created, so your username is @${finalUsername}.`;
}
