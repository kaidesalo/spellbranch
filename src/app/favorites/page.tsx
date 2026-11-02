import Image from "next/image";
import { requireUser } from "@/lib/auth/require-user";
import { removeFavoriteAction } from "@/lib/actions/favorites";
import { listFavorites } from "@/lib/queries/favorites";
import { Button } from "@/components/ui/button";
import { CardZoom } from "@/components/cards/card-zoom";
import { ManaCost } from "@/components/cards/mana-symbols";
import { zoomCardFromSaved } from "@/lib/card-zoom";

export default async function FavoritesPage() {
  await requireUser();
  const favorites = await listFavorites();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Favorite cards</h1>
      <p className="mt-1 text-muted-foreground">
        Cards you starred while searching or building decks.
      </p>

      {favorites.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-medium">No favorites yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a deck and tap Favorite on any Scryfall result.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {favorites.map((card) => (
            <li
              key={card.id}
              className="rounded-2xl border border-border/80 bg-card/70 p-4"
            >
              <div className="flex gap-3">
                {card.imageUri ? (
                  <CardZoom
                    card={zoomCardFromSaved(card.cardName, card.imageUri)}
                    className="shrink-0 self-start"
                  >
                    <Image
                      src={card.imageUri}
                      alt={card.cardName}
                      width={72}
                      height={100}
                      className="rounded-lg"
                      unoptimized
                    />
                  </CardZoom>
                ) : (
                  <div className="h-[100px] w-[72px] rounded-lg bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{card.cardName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <ManaCost cost={card.manaCost} fallback="—" />
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {card.typeLine}
                  </p>
                  <form
                    action={async () => {
                      "use server";
                      await removeFavoriteAction(card.id);
                    }}
                    className="mt-3"
                  >
                    <Button type="submit" size="sm" variant="outline">
                      Remove
                    </Button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
