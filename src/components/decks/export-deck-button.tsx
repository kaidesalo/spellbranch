"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { decklistFilename, exportDecklist, type ExportDeckCard } from "@/lib/decklist/export";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function ExportDeckButton({
  deckName,
  commanderName,
  cards,
}: {
  deckName: string;
  commanderName: string | null;
  cards: readonly ExportDeckCard[];
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const text = exportDecklist({ commanderName, cards });

  async function copy() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Clipboard is blocked. Select the list and copy it.");
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = decklistFilename(deckName);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          setCopyError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-sm:px-2 max-sm:tracking-normal!"
          />
        }
      >
        <Download data-icon="inline-start" />
        Export
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export deck list</DialogTitle>
          <DialogDescription>
            Paste this into Moxfield or Archidekt. Each line is a quantity and a card name, like 1
            Sol Ring. Sideboard and Maybeboard, when this deck has them, follow the main list under
            those headings. Importing the text brings back the main list only.
            {commanderName
              ? " The commander is the first line, then a blank line, which is how Moxfield marks the commander. In Archidekt, move that card into the Commander category if it lands in the deck."
              : ""}
          </DialogDescription>
        </DialogHeader>
        {text ? (
          <>
            <Textarea
              readOnly
              value={text}
              spellCheck={false}
              aria-label="Exported deck list"
              className="max-h-[50dvh] min-h-48 font-mono"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={download} className="w-full sm:w-auto">
                <Download data-icon="inline-start" />
                Download
              </Button>
              <Button type="button" onClick={copy} className="w-full sm:w-auto">
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {copyError && <p className="text-sm text-destructive">{copyError}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This deck has no cards to export yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
