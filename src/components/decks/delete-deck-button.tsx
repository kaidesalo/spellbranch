"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteDeckAction } from "@/lib/actions/decks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Delete button + confirm dialog for the deck's owner. The page only renders
 * it when canEdit (owner) is true; the server action checks ownership again.
 * Typing the deck name arms the button. On success the action redirects to
 * /decks, so this component never sees a success result.
 */
export function DeleteDeckButton({
  deckId,
  deckName,
  size = "sm",
}: {
  deckId: string;
  deckName: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const confirmed = typed.trim() === deckName.trim();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setTyped("");
  }

  function onDelete() {
    if (!confirmed) return;
    startTransition(async () => {
      const result = await deleteDeckAction(deckId);
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="destructive" size={size} />}>
        <Trash2 data-icon="inline-start" />
        Delete deck
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this deck?</DialogTitle>
          <DialogDescription>
            This permanently removes the deck, its cards and its comments.
            Branches forked from it stay, with their own lists.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onDelete();
          }}
        >
          <Label htmlFor="confirm-deck-name">
            Type <span className="font-semibold">{deckName}</span> to confirm
          </Label>
          <Input
            id="confirm-deck-name"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={pending}
          />
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={!confirmed || pending}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
