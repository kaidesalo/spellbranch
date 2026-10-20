import { requireUser } from "@/lib/auth/require-user";
import { getRequestedUsername } from "@/lib/auth/session";
import { usernameChangedNotice } from "@/lib/auth/username-notice";
import { getOwnProfile } from "@/lib/queries/profiles";
import { ProfileForm } from "@/components/auth/profile-form";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default async function ProfilePage() {
  const user = await requireUser();
  const [profile, requested] = await Promise.all([getOwnProfile(), getRequestedUsername()]);
  const notice = usernameChangedNotice(requested, profile?.username ?? user.username);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Profile</h1>
      <p className="mt-1 text-muted-foreground">
        How friends see you across Spellbranch. Friends find you by your exact
        username.
      </p>
      {notice && (
        <Alert className="mt-6" data-testid="username-notice">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <div className="mt-8 rounded-2xl border border-border/80 bg-card/70 p-6">
        <ProfileForm
          user={profile ? { ...user, username: profile.username } : user}
          bio={profile?.bio ?? ""}
        />
      </div>
    </div>
  );
}
