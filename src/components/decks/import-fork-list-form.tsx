"use client";

import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import {
  importForkDecklistAction,
  type ForkImportChange,
  type ForkImportPreview,
} from "@/lib/actions/fork-import";
import { BOARD_LABEL } from "@/lib/deck-boards";
import { DECKLIST_MAX_CHARS, pastedListProblem } from "@/lib/decklist/parse";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const PLACEHOLDER = `1 Atraxa, Praetors' Voice

1 Sol Ring
1 Arcane Signet
8 Forest`;

const BOARD_TEXT: Record<ForkImportChange["board"], string> = {
  main: BOARD_LABEL.main,
  side: BOARD_LABEL.side,
  maybe: BOARD_LABEL.maybe,
  commander: "Commander",
};

/**
 * Paste a deck list onto a branch the signed-in user owns. The first step
 * only previews how that list differs from the original deck. Nothing is
 * saved until Save import.
 */
export function ImportForkListForm({
  deckId,
  originalName,
}: {
  deckId: string;
  originalName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ForkImportPreview | null>(null);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"preview" | "save">("preview");
  const listRef = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  const listProblem = list.trim() ? pastedListProblem(list) : null;

  function onOpenChange(next: boolean) {
    if (lock.current) return;
    setOpen(next);
    if (!next) {
      setList("");
      setPreview(null);
      setError(null);
    }
  }

  function run(confirm: boolean) {
    if (lock.current) return;
    const problem = pastedListProblem(list);
    if (problem) {
      setError(problem);
      listRef.current?.focus();
      return;
    }
    const formData = new FormData();
    formData.set("list", list);
    if (confirm) formData.set("confirm", "true");
    setError(null);
    setMode(confirm ? "save" : "preview");
    if (confirm) lock.current = true;
    startTransition(async () => {
      try {
        const result = await importForkDecklistAction(deckId, formData);
        if (result?.error) {
          setError(result.error);
          if (result.preview) setPreview(result.preview);
          return;
        }
        if (result?.saved) {
          toast.success("Imported deck list");
          setOpen(false);
          setList("");
          setPreview(null);
          router.refresh();
          return;
        }
        if (result?.preview) setPreview(result.preview);
      } catch (err) {
        const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : "";
        if (digest.startsWith("NEXT_REDIRECT")) throw err;
        setError("Could not import that list.");
      } finally {
        lock.current = false;
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="import-fork-list"
            aria-label="Import deck list"
            className="h-8 max-sm:px-2 max-sm:tracking-normal!"
          />
        }
      >
        <ClipboardList data-icon="inline-start" />
        <span className="sm:hidden">Import</span>
        <span className="hidden sm:inline">Import deck list</span>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[min(90dvh,44rem)] w-full max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        aria-modal="true"
        initialFocus={() => listRef.current}
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <DialogHeader className="shrink-0 pt-4 pr-12 pl-4">
            <DialogTitle>Import a deck list</DialogTitle>
            <DialogDescription>
              Paste a list to replace this branch&apos;s cards. You&apos;ll see what changed from{" "}
              {originalName} before anything is saved. The original deck stays as it is.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="space-y-2">
              <Label htmlFor={`fork-import-list-${deckId}`}>Deck list</Label>
              <Textarea
                ref={listRef}
                id={`fork-import-list-${deckId}`}
                name="list"
                required
                rows={8}
                maxLength={DECKLIST_MAX_CHARS}
                value={list}
                onChange={(event) => {
                  setList(event.target.value);
                  setPreview(null);
                  setError(null);
                }}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                autoComplete="off"
                disabled={pending}
                aria-describedby={`fork-import-hint-${deckId}`}
                className="min-h-36 font-mono text-base sm:text-sm"
              />
              <p id={`fork-import-hint-${deckId}`} className="text-xs text-muted-foreground">
                One card per line, like <span className="font-mono">1 Sol Ring</span>. On a Commander
                list, the commander is the line before the first blank line. Sideboard and maybeboard
                piles are left out, the same as a new import.
              </p>
            </div>

            {listProblem && (
              <Alert variant="destructive">
                <AlertDescription>{listProblem}</AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {preview && <ForkImportDiff preview={preview} />}
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t sm:justify-end">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                  disabled={pending && mode === "save"}
                />
              }
            >
              Cancel
            </DialogClose>
            {preview ? (
              <Button
                type="button"
                className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                disabled={pending || Boolean(listProblem)}
                onClick={() => run(true)}
              >
                {pending && mode === "save" ? "Saving…" : "Save import"}
              </Button>
            ) : (
              <Button
                type="submit"
                className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                disabled={pending || Boolean(listProblem) || !list.trim()}
              >
                {pending && mode === "preview" ? "Checking…" : "Preview changes"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ForkImportDiff({ preview }: { preview: ForkImportPreview }) {
  const { summary } = preview;
  return (
    <section
      data-testid="import-fork-diff"
      aria-label={`Changes from ${preview.originalName}`}
      className="space-y-3"
    >
      <div>
        <h3 className="text-sm font-semibold">Changes from {preview.originalName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Original quantity, then the imported quantity. Commander, sideboard, and maybeboard are
          labeled.
        </p>
      </div>
      <ul className="flex flex-wrap gap-2 text-xs font-medium">
        <li className="rounded-full bg-emerald-700 px-2.5 py-1 text-white tabular-nums">
          +{summary.added} added
        </li>
        <li className="rounded-full bg-rose-700 px-2.5 py-1 text-white tabular-nums">
          −{summary.removed} removed
        </li>
        <li className="rounded-full bg-amber-600 px-2.5 py-1 text-[#10141F] tabular-nums">
          {summary.quantity} quantity
        </li>
        <li className="rounded-full border border-border px-2.5 py-1 tabular-nums text-muted-foreground">
          {summary.unchanged} unchanged
        </li>
      </ul>
      <CommanderLine preview={preview} />
      {preview.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {preview.changes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          This list matches the original deck. Saving still replaces this branch with it.
        </p>
      ) : (
        <ol className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
          {preview.changes.map((change) => (
            <li
              key={`${change.board}:${change.scryfallId}:${change.kind}`}
              className={cn(
                "border-l-4 px-3 py-2.5",
                change.kind === "added" && "border-l-emerald-700 bg-emerald-400/15",
                change.kind === "removed" && "border-l-rose-700 bg-rose-400/15",
                change.kind === "quantity" && "border-l-amber-600 bg-amber-300/20",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-medium leading-snug">
                  <span className="mr-2 align-middle text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {change.kind === "added" ? "Added" : change.kind === "removed" ? "Removed" : "Quantity"}
                  </span>
                  {change.cardName}
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {BOARD_TEXT[change.board]}
                    {change.typeLine ? ` · ${change.typeLine}` : ""}
                  </span>
                </p>
                <p className="shrink-0 pt-0.5 text-sm font-medium tabular-nums">
                  <span className="text-muted-foreground">{change.originalQty}</span>
                  <span className="mx-1 text-muted-foreground" aria-hidden>
                    →
                  </span>
                  <span>{change.importQty}</span>
                  <span className="sr-only">
                    {change.kind === "quantity"
                      ? `, quantity ${change.originalQty} to ${change.importQty}`
                      : change.kind === "added"
                        ? ", added"
                        : ", removed"}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CommanderLine({ preview }: { preview: ForkImportPreview }) {
  if (preview.commanderChange === "none" || preview.commanderChange === "same") {
    if (!preview.commanderOriginalName && !preview.commanderImportName) return null;
    if (preview.commanderChange === "same" && preview.commanderOriginalName) {
      return (
        <p className="text-sm">
          Commander stays <span className="font-medium">{preview.commanderOriginalName}</span>.
        </p>
      );
    }
    return null;
  }
  return (
    <p className="text-sm">
      Commander:{" "}
      <span className={preview.commanderOriginalName ? "text-rose-700 line-through dark:text-rose-300" : ""}>
        {preview.commanderOriginalName ?? "None"}
      </span>
      <span className="mx-1.5 text-muted-foreground" aria-hidden>
        →
      </span>
      <span className={preview.commanderImportName ? "font-medium text-emerald-800 dark:text-emerald-300" : ""}>
        {preview.commanderImportName ?? "None"}
      </span>
    </p>
  );
}
