"use client";

import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Copy } from "lucide-react";
import { copyDeckAction } from "@/lib/actions/decks";
import { LIMITS } from "@/lib/data/limits";
import { forkNameError } from "@/lib/fork-name";
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
 * Copy opens a dialog for the new deck's name. Nothing is created until
 * Copy is confirmed. The default matches "<source> (copy)". The new deck is
 * independent: it is not a branch of the source.
 */
export function CopyDeckForm({
  deckId,
  defaultName,
  defaultOpen = false,
}: {
  deckId: string;
  defaultName: string;
  /** Opens the naming dialog on first render. The deck page leaves this unset. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const fieldId = `copy-name-${deckId}`;
  const errorId = `${fieldId}-error`;

  function onOpenChange(next: boolean) {
    if (lock.current) return;
    setOpen(next);
    if (next) {
      setName(defaultName);
      setError(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const problem = forkNameError(name);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    const formData = new FormData();
    formData.set("name", name.trim());
    setError(null);
    lock.current = true;
    startTransition(async () => {
      const result = await copyDeckAction(deckId, formData);
      if (result?.error) {
        lock.current = false;
        setError(result.error);
        inputRef.current?.focus();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Copy deck"
            className="h-8 max-sm:px-2 max-sm:tracking-normal!"
          />
        }
      >
        <Copy data-icon="inline-start" />
        <span className="sm:hidden">Copy</span>
        <span className="hidden sm:inline">Copy deck</span>
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        aria-modal="true"
        initialFocus={() => inputRef.current}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Copy this deck</DialogTitle>
          <DialogDescription>
            Name the new deck. It is a separate deck, not a branch. Anyone who can see the copy
            will see this name.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor={fieldId}>Deck name</Label>
            <Input
              ref={inputRef}
              id={fieldId}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              required
              maxLength={LIMITS.deckName}
              autoComplete="off"
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="h-11 text-base"
            />
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="mt-1">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                  disabled={pending}
                />
              }
            >
              Cancel
            </DialogClose>
            <Button
              type="submit"
              className="min-h-11 w-full sm:min-h-8 sm:w-auto"
              disabled={pending}
            >
              {pending ? "Copying…" : "Copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
