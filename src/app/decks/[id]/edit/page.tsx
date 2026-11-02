import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { deleteDeckAction, updateDeckMetaAction } from "@/lib/actions/decks";
import { canUserEdit, getDeckById } from "@/lib/queries/decks";
import { DeckForm } from "@/components/decks/deck-form";
import { Button } from "@/components/ui/button";

export default async function EditDeckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const deck = await getDeckById(id);
  if (!deck) notFound();

  const canEdit = await canUserEdit(id);
  if (!canEdit) redirect(`/decks/${id}`);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Button variant="ghost" size="sm" render={<Link href={`/decks/${id}`} />}>
          ← Back to deck
        </Button>
      </div>
      <h1 className="font-heading text-3xl font-semibold">Deck settings</h1>
      <p className="mt-1 text-muted-foreground">
        Update name, format, visibility, and fork permissions.
      </p>
      <div className="mt-8 rounded-2xl border border-border/80 bg-card/70 p-6">
        <DeckForm
          deck={deck}
          action={updateDeckMetaAction.bind(null, id)}
          submitLabel="Save changes"
        />
      </div>

      <div className="mt-8 rounded-2xl border border-destructive/30 bg-card/70 p-6">
        <h2 className="font-heading text-lg font-semibold text-destructive">
          Delete deck
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This removes the deck, its cards, and its comments. Branches that
          forked from it keep their own lists.
        </p>
        <form
          action={async () => {
            "use server";
            await deleteDeckAction(id);
          }}
          className="mt-4"
        >
          <Button type="submit" variant="destructive">
            Delete permanently
          </Button>
        </form>
      </div>
    </div>
  );
}
