import { requireUser } from "@/lib/actions/auth";
import { readStore } from "@/lib/data/store";
import { getSupabaseProfileBio } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ProfileForm } from "@/components/auth/profile-form";

export default async function ProfilePage() {
  const user = await requireUser();
  const bio = isSupabaseConfigured()
    ? await getSupabaseProfileBio(user.id)
    : ((await readStore()).users.find((u) => u.id === user.id)?.bio ?? "");

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Profile</h1>
      <p className="mt-1 text-muted-foreground">
        How friends see you across Spellbranch.
      </p>
      <div className="mt-8 rounded-2xl border border-border/80 bg-card/70 p-6">
        <ProfileForm user={user} bio={bio} />
      </div>
    </div>
  );
}
