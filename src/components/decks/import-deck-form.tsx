"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { importDeckAction, type ImportDeckResult } from "@/lib/actions/deck-import";
import { DECKLIST_MAX_CHARS, parseDecklist, pastedListProblem } from "@/lib/decklist/parse";
import { DECK_FORMATS, VISIBILITY_OPTIONS, type DeckFormat } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const PLACEHOLDER = `1 Atraxa, Praetors' Voice

1 Sol Ring
1 Arcane Signet
10 Forest`;

export function ImportDeckForm() {
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportDeckResult | null>(null);
  const [format, setFormat] = useState<DeckFormat>("commander");
  const [list, setList] = useState("");
  const [pending, startTransition] = useTransition();

  const listProblem = list.trim() ? pastedListProblem(list) : null;
  const preview = useMemo(() => {
    if (!list.trim() || listProblem) return null;
    return parseDecklist(list, { commanderBlankLine: format === "commander" });
  }, [list, listProblem, format]);

  const listCount = preview?.cards.reduce((sum, card) => sum + card.quantity, 0) ?? 0;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        setOutcome(null);
        startTransition(async () => {
          const result = await importDeckAction(formData);
          if (result?.error) {
            setError(result.error);
            if (result.id) setOutcome(result);
            return;
          }
          if (result?.id) setOutcome(result);
        });
      }}
    >
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Copy the list out of the other site, then paste it below. A deck link is not downloaded.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-foreground">Moxfield.</span> More → Export → Plain Text.
            On a Commander list, the commander is the line before the first blank line.
          </li>
          <li>
            <span className="font-medium text-foreground">Archidekt.</span> Export → Text. Category
            headings such as Commander and Lands are fine. Maybeboard and sideboard piles are left out.
          </li>
        </ul>
      </div>

      <div className="space-y-2">
        <Label htmlFor="import-name">Deck name</Label>
        <Input
          id="import-name"
          name="name"
          required
          maxLength={80}
          placeholder="Atraxa, from Moxfield"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="import-format">Format</Label>
          <select
            id="import-format"
            name="format"
            value={format}
            onChange={(event) => setFormat(event.target.value as DeckFormat)}
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            {DECK_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="import-visibility">Visibility</Label>
          <select
            id="import-visibility"
            name="visibility"
            defaultValue="private"
            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            {VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="import-list">Deck list</Label>
        <Textarea
          id="import-list"
          name="list"
          required
          rows={12}
          maxLength={DECKLIST_MAX_CHARS}
          value={list}
          onChange={(event) => {
            setList(event.target.value);
            setOutcome(null);
          }}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          autoComplete="off"
          className="min-h-52 font-mono"
          aria-describedby="import-list-hint"
        />
        <p id="import-list-hint" className="text-xs text-muted-foreground">
          One card per line, like <span className="font-mono">1 Sol Ring</span> or{" "}
          <span className="font-mono">10 Forest</span>. Set codes are ignored. Colors are taken from
          the cards Scryfall returns, so the list fits. You can narrow them later in Settings.
        </p>
      </div>

      {listProblem && (
        <Alert variant="destructive">
          <AlertDescription>{listProblem}</AlertDescription>
        </Alert>
      )}

      {preview && (
        <div className="rounded-xl bg-secondary/50 px-3 py-3 text-sm" aria-live="polite">
          <p>
            {preview.commanders.length > 0
              ? `Commander: ${preview.commanders.map((card) => card.name).join(", ")}`
              : format === "commander"
                ? "No commander marked. Put it on the line before the first blank line, or under a Commander heading."
                : "No command zone in this format. Every card goes in the deck list."}
          </p>
          <p className="mt-1 text-muted-foreground">
            {listCount} {listCount === 1 ? "card" : "cards"} in the deck list
          </p>
          {preview.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="allowForks"
          value="true"
          defaultChecked
          className="size-4 rounded border-input"
        />
        Allow friends with access to fork this deck
      </label>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{error}</p>
            {outcome?.id && (
              <Button className="mt-3" render={<Link href={`/decks/${outcome.id}`} />}>
                Open the deck that was started
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {outcome?.id && !error && (
        <Alert>
          <AlertDescription>
            <p>
              {outcome.commanderName && !outcome.added
                ? `Saved ${outcome.commanderName} as commander.`
                : `Saved ${outcome.added ?? 0} ${(outcome.added ?? 0) === 1 ? "card" : "cards"}${
                    outcome.commanderName ? ` with ${outcome.commanderName} as commander` : ""
                  }.`}
            </p>
            {outcome.warnings && outcome.warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {outcome.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button render={<Link href={`/decks/${outcome.id}`} />}>Open deck</Button>
              <Button type="button" variant="outline" onClick={() => setOutcome(null)}>
                Import another
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {(!outcome?.id || error) && (
        <Button type="submit" disabled={pending || Boolean(listProblem)} className="w-full sm:w-auto">
          {pending ? "Importing…" : "Import deck"}
        </Button>
      )}
    </form>
  );
}
