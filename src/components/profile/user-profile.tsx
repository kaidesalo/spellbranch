import Link from "next/link";
import type { CollectionCard, DeckWithMeta, VisibleProfile } from "@/lib/types";
import { FINISH_LABEL } from "@/lib/collection";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { Button } from "@/components/ui/button";
import { DeckCardSummary } from "@/components/decks/deck-card-summary";

export function UserProfile({
  profile,
  decks,
  tradeCards = [],
  isSelf,
}: {
  profile: VisibleProfile;
  decks: DeckWithMeta[];
  tradeCards?: CollectionCard[];
  isSelf: boolean;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex items-start gap-4 sm:gap-5">
        <ProfileAvatar
          avatarPreset={profile.avatarPreset}
          avatarUrl={profile.avatarUrl}
          displayName={profile.displayName}
          username={profile.username}
          size="profile"
        />
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

      <section className="mt-8" data-testid="profile-trade">
        <h2 className="text-lg font-semibold">Available for trade</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cards this person has marked for trade. A private collection stays hidden.
        </p>
        {tradeCards.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing listed for trade.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
            {tradeCards.map((card) => (
              <li key={card.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{card.cardName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {card.quantity} · {FINISH_LABEL[card.finish]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
