import { requireUser } from "@/lib/actions/auth";
import { readStore } from "@/lib/data/store";
import { ProfileForm } from "@/components/auth/profile-form";

export default async function ProfilePage() {
  const user = await requireUser();
  const store = await readStore();
  const profile = store.users.find((u) => u.id === user.id);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Profile</h1>
      <p className="mt-1 text-muted-foreground">
        How friends see you across Spellbranch.
      </p>
      <div className="mt-8 rounded-2xl border border-border/80 bg-card/70 p-6">
        <ProfileForm user={user} bio={profile?.bio ?? ""} />
      </div>
    </div>
  );
}
