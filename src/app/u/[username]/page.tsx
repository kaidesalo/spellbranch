import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUserProfile } from "@/lib/queries/profiles";
import { UserProfile } from "@/components/profile/user-profile";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const view = await getUserProfile(username);
  if (!view) return { title: "Profile — Spellbranch" };
  // Display name and username only. Bio stays out of the document title.
  return {
    title: `${view.profile.displayName} (@${view.profile.username}) — Spellbranch`,
  };
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const [view, viewer] = await Promise.all([getUserProfile(username), getSessionUser()]);
  if (!view) notFound();

  return (
    <UserProfile
      profile={view.profile}
      decks={view.decks}
      isSelf={viewer?.id === view.profile.id}
    />
  );
}
