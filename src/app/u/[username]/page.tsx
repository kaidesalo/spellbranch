import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getUserProfile } from "@/lib/queries/profiles";
import { getRepository } from "@/lib/data";
import { limit, limitMessage, requestIp } from "@/lib/rate-limit";
import { UserProfile } from "@/components/profile/user-profile";

/** One hit per request, shared by generateMetadata and the page. */
const allowProfileView = cache(async () => limit("profile-view", { ip: await requestIp() }));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const allowed = await allowProfileView();
  if (!allowed.ok) return { title: "Profile — Spellbranch" };
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
  const allowed = await allowProfileView();
  if (!allowed.ok) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <p className="text-sm text-muted-foreground">{limitMessage(allowed)}</p>
      </div>
    );
  }
  const [view, viewer] = await Promise.all([getUserProfile(username), getSessionUser()]);
  if (!view) notFound();
  const tradeCards = await getRepository().listTradeCollection(viewer?.id ?? null, view.profile.id);

  return (
    <UserProfile
      profile={view.profile}
      decks={view.decks}
      tradeCards={tradeCards}
      isSelf={viewer?.id === view.profile.id}
    />
  );
}
