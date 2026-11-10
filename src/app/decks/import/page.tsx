import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { ImportDeckForm } from "@/components/decks/import-deck-form";

export default async function ImportDeckPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-semibold">Import a deck</h1>
      <p className="mt-1 text-muted-foreground">
        Bring a list over from Moxfield or Archidekt. Spellbranch creates a new deck and looks each
        card up on Scryfall.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Starting from scratch?{" "}
        <Link href="/decks/new" className="font-medium text-primary underline-offset-4 hover:underline">
          Create an empty deck
        </Link>
        .
      </p>
      <div className="mt-8 rounded-2xl border border-border/80 bg-card/70 p-4 sm:p-6">
        <ImportDeckForm />
      </div>
    </div>
  );
}
