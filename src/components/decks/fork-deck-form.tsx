"use client";

import { useState, useTransition } from "react";
import { GitBranch } from "lucide-react";
import { forkDeckAction } from "@/lib/actions/decks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Name field plus Fork. The default matches the old automatic
 * "<source> (branch)" name; the person forking can edit it first.
 */
export function ForkDeckForm({
  deckId,
  defaultName,
}: {
  deckId: string;
  defaultName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldId = `fork-name-${deckId}`;

  return (
    <form
      className="grid w-full min-w-0 basis-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 sm:w-80 sm:basis-auto"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await forkDeckAction(deckId, formData);
          if (result?.error) setError(result.error);
        });
      }}
    >
      <Label htmlFor={fieldId} className="col-span-2">
        Branch name
      </Label>
      <Input
        id={fieldId}
        name="name"
        required
        maxLength={80}
        defaultValue={defaultName}
        autoComplete="off"
        disabled={pending}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className="min-w-0"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label="Fork deck"
        className="h-8 max-sm:px-2 max-sm:tracking-normal!"
      >
        <GitBranch data-icon="inline-start" />
        <span className="sm:hidden">{pending ? "…" : "Fork"}</span>
        <span className="hidden sm:inline">{pending ? "Forking…" : "Fork deck"}</span>
      </Button>
      {error ? (
        <p id={`${fieldId}-error`} className="col-span-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
