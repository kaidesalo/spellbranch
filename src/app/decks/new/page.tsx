import { requireUser } from "@/lib/auth/require-user";
import { createDeckAction } from "@/lib/actions/decks";
import { DeckForm } from "@/components/decks/deck-form";

export default async function NewDeckPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Create a deck</h1>
      <p className="mt-1 text-muted-foreground">
        Name your list, pick a format, and choose who can see or fork it.
      </p>
      <div className="mt-8 rounded-2xl border border-border/80 bg-card/70 p-6">
        <DeckForm action={createDeckAction} submitLabel="Create deck" />
      </div>
    </div>
  );
}
