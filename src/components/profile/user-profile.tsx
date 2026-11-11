import Link from "next/link";
import type { DeckWithMeta, VisibleProfile } from "@/lib/types";
import { profileInitials, safeAvatarUrl } from "@/lib/profile-display";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DeckCardSummary } from "@/components/decks/deck-card-summary";

export function UserProfile({
  profile,
  decks,
  isSelf,
}: {
  profile: VisibleProfile;
  decks: DeckWithMeta[];
  isSelf: boolean;
}) {
  const avatarUrl = safeAvatarUrl(profile.avatarUrl);
  const initials = profileInitials(profile.displayName, profile.username);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex items-start gap-4 sm:gap-5">
        <Avatar data-testid="profile-avatar" className="size-16 sm:size-20">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" keepMounted /> : null}
          <AvatarFallback className="bg-secondary text-base font-medium text-primary sm:text-lg">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-semibold">{profile.displayName}</h1>
              <p className="mt-1 text-muted-foreground">@{profile.username}</p>
            </div>
            {isSelf && (
              <Button variant="outline" size="sm" render={<Link href="/profile" />}>
                Edit profile
              </Button>
            )}
          </div>
        </div>
      </header>

      {profile.bio !== null && (
        <p
          data-testid="profile-bio"
          className="mt-6 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed"
        >
          {profile.bio.trim() ? (
            profile.bio
          ) : (
            <span className="text-muted-foreground">No bio yet.</span>
          )}
        </p>
      )}

      <section className="mt-8" data-testid="profile-decks">
        <h2 className="text-lg font-semibold">Decks</h2>
        {decks.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No decks to show.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((deck) => (
              <DeckCardSummary key={deck.id} deck={deck} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
