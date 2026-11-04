"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DECK_FORMATS, VISIBILITY_OPTIONS, type Deck } from "@/lib/types";
import type { ActionResult } from "@/lib/actions/decks";
import { ColorPicker } from "./deck-colors";

export function DeckForm({
  deck,
  action,
  submitLabel,
}: {
  deck?: Deck;
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [offColorCards, setOffColorCards] = useState<string[]>([]);
  // New decks must pick colors; a deck from before deck colors may keep none.
  const colorsRequired = !deck || deck.colors !== null;
  const [pending, startTransition] = useTransition();
  const [format, setFormat] = useState<string>(deck?.format ?? "commander");
  const commanderWillClear =
    Boolean(deck?.commander) && deck?.format === "commander" && format !== "commander";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        setError(null);
        setOffColorCards([]);
        startTransition(async () => {
          const result = await action(formData);
          if (result?.error) {
            setError(result.error);
            setOffColorCards(result.offColorCards ?? []);
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="name">Deck name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          defaultValue={deck?.name}
          placeholder="Simic Value Town"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="format">Format</Label>
          <select
            id="format"
            name="format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            aria-describedby={commanderWillClear ? "format-commander-hint" : undefined}
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            {DECK_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {commanderWillClear && (
            <p id="format-commander-hint" className="text-xs text-muted-foreground">
              Only Commander decks have a commander. Saving with this format
              clears {deck!.commander!.cardName} as the commander.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <select
            id="visibility"
            name="visibility"
            defaultValue={deck?.visibility ?? "private"}
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            {VISIBILITY_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border-2 border-[#4b3d44] bg-[#d2c9a5]/40 p-4">
        <ColorPicker
          defaultColors={deck?.colors ?? null}
          required={colorsRequired}
          describedBy="colors-hint"
        />
        <p id="colors-hint" className="mt-3 text-xs text-muted-foreground">
          {deck && deck.colors === null
            ? "This deck has no colors yet, so any card can be added. Pick colors to restrict it to cards whose color identity fits."
            : "Only cards whose color identity fits inside these colors can be added. Colorless cards always fit."}
          {deck?.commander && " The colors must include your commander's color identity."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={2000}
          defaultValue={deck?.notes}
          placeholder="Game plan, mulligan notes, or spicy tech ideas…"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="allowForks"
          value="true"
          defaultChecked={deck?.allowForks ?? true}
          className="size-4 rounded border-input"
        />
        Allow friends with access to fork this deck
      </label>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{error}</p>
            {offColorCards.length > 0 && (
              <ul className="mt-2 list-disc pl-5" aria-label="Cards that don't fit">
                {offColorCards.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
