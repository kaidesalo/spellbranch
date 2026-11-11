"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  compareDeckLists,
  findReplacements,
  summarizeDiffs,
} from "@/lib/deck-diff";
import { setPreferredBranchAction } from "@/lib/actions/decks";
import { compareCommanders, type CompareSide } from "@/lib/compare-dto";
import { BOARD_LABEL, normalizeBoard } from "@/lib/deck-boards";
import { deckCountLabel } from "@/lib/commander";
import { cn } from "@/lib/utils";
import { CardZoom } from "@/components/cards/card-zoom";
import { ManaCost } from "@/components/cards/mana-symbols";
import { zoomCardFromSaved } from "@/lib/card-zoom";

export function CompareView({
  source,
  branch,
  isPreferred,
  canSetPreferred,
  kind = "branch",
}: {
  source: CompareSide;
  branch: CompareSide;
  isPreferred: boolean;
  canSetPreferred: boolean;
  /** A copy uses the same layout; the right-hand side is the copy, not a branch. */
  kind?: "branch" | "copy";
}) {
  const diffs = compareDeckLists(source.cards, branch.cards);
  const summary = summarizeDiffs(diffs);
  const replacements = findReplacements(diffs);
  const changed = diffs.filter((d) => d.kind !== "unchanged");
  const commanderChange = compareCommanders(source.commander, branch.commander);
  const [pending, startTransition] = useTransition();

  function setPreferred(value: string | null) {
    startTransition(async () => {
      const result = await setPreferredBranchAction(source.id, value);
      if (result.error) toast.error(result.error);
      else
        toast.success(
          value ? "Preferred branch updated" : "Preferred branch cleared",
        );
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border/80 bg-card/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Source
          </p>
          <h2 className="font-display break-words text-xl font-semibold">{source.name}</h2>
          <p className="mt-1 text-sm font-medium tabular-nums text-muted-foreground capitalize">
            {source.format} · {deckCountLabel(source.cardCount, Boolean(source.commander))}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            render={<Link href={`/decks/${source.id}`} />}
          >
            Open source
          </Button>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            {kind === "copy" ? "Copy" : "Branch"}
          </p>
          <h2 className="font-display break-words text-xl font-semibold">{branch.name}</h2>
          <p className="mt-1 text-sm font-medium tabular-nums text-muted-foreground capitalize">
            {branch.format} · {deckCountLabel(branch.cardCount, Boolean(branch.commander))}
            {branch.ownerUsername ? ` · @${branch.ownerUsername}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              render={<Link href={`/decks/${branch.id}`} />}
            >
              {kind === "copy" ? "Open copy" : "Open branch"}
            </Button>
            {canSetPreferred && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => setPreferred(isPreferred ? null : branch.id)}
              >
                {isPreferred ? "Clear preferred" : "Set as preferred"}
              </Button>
            )}
            {isPreferred && <Badge>Preferred</Badge>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge className="bg-emerald-700 font-medium! tabular-nums text-white hover:bg-emerald-700">
          +{summary.added} added
        </Badge>
        <Badge className="bg-rose-700 font-medium! tabular-nums text-white hover:bg-rose-700">
          −{summary.removed} removed
        </Badge>
        <Badge className="bg-amber-600 font-medium! tabular-nums text-[#10141F] hover:bg-amber-600">
          {summary.quantity} quantity
        </Badge>
        <Badge variant="secondary" className="font-medium! tabular-nums">
          {replacements.length} replaced
        </Badge>
        <Badge variant="outline" className="font-medium! tabular-nums">
          {summary.unchanged} unchanged
        </Badge>
        {(commanderChange === "added" ||
          commanderChange === "removed" ||
          commanderChange === "changed") && (
          <Badge>
            commander {commanderChange}
          </Badge>
        )}
      </div>

      {commanderChange !== "none" && (
        <section>
          <h3 className="mb-2 text-lg font-semibold">Commander</h3>
          <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm">
            {commanderChange === "same" ? (
              <p>
                Both lead with{" "}
                <CardZoom
                  card={zoomCardFromSaved(source.commander!.cardName, source.commander!.imageUri)}
                  className="font-medium hover:underline"
                >
                  {source.commander!.cardName}
                </CardZoom>
                .
              </p>
            ) : (
              <p>
                <span className={source.commander ? "text-rose-300 line-through" : "text-muted-foreground"}>
                  {source.commander ? (
                    <CardZoom
                      card={zoomCardFromSaved(source.commander.cardName, source.commander.imageUri)}
                      className="hover:decoration-2"
                    >
                      {source.commander.cardName}
                    </CardZoom>
                  ) : (
                    "No commander"
                  )}
                </span>
                <span className="mx-2 text-muted-foreground">→</span>
                <span className={branch.commander ? "font-medium text-emerald-300" : "text-muted-foreground"}>
                  {branch.commander ? (
                    <CardZoom
                      card={zoomCardFromSaved(branch.commander.cardName, branch.commander.imageUri)}
                      className="hover:underline"
                    >
                      {branch.commander.cardName}
                    </CardZoom>
                  ) : (
                    "No commander"
                  )}
                </span>
              </p>
            )}
          </div>
        </section>
      )}

      {replacements.length > 0 && (
        <section>
          <h3 className="mb-2 text-lg font-semibold">Replacements</h3>
          <ul className="space-y-2">
            {replacements.map((pair) => (
              <li
                key={`${pair.removed.scryfallId}:${normalizeBoard(pair.removed.board)}-${pair.added.scryfallId}:${normalizeBoard(pair.added.board)}`}
                className="rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm"
              >
                <span className="text-rose-300 line-through">
                  <CardZoom
                    card={zoomCardFromSaved(pair.removed.cardName, pair.removed.imageUri)}
                    className="hover:decoration-2"
                  >
                    {pair.removed.cardName}
                  </CardZoom>
                </span>
                <span className="mx-2 text-muted-foreground">→</span>
                <span className="font-medium text-emerald-300">
                  <CardZoom
                    card={zoomCardFromSaved(pair.added.cardName, pair.added.imageUri)}
                    className="hover:underline"
                  >
                    {pair.added.cardName}
                  </CardZoom>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-lg font-semibold">Card changes</h3>
        {changed.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            These lists are identical.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Card</span>
              <span>Source</span>
              <span>{kind === "copy" ? "Copy" : "Branch"}</span>
            </div>
            <ul className="divide-y divide-border/70 bg-background/50">
              {changed.map((diff) => (
                <li
                  key={`${diff.scryfallId}:${normalizeBoard(diff.board)}`}
                  className={cn(
                    "grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 py-2 text-sm",
                    diff.kind === "added" && "bg-emerald-400/15",
                    diff.kind === "removed" && "bg-rose-400/15",
                    diff.kind === "quantity" && "bg-amber-300/15",
                  )}
                >
                  <div>
                    <p className="font-medium">
                      <CardZoom
                        card={zoomCardFromSaved(diff.cardName, diff.imageUri)}
                        className="hover:underline"
                      >
                        {diff.cardName}
                      </CardZoom>
                      {normalizeBoard(diff.board) !== "main" && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {BOARD_LABEL[normalizeBoard(diff.board)]}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <ManaCost cost={diff.manaCost} fallback="—" /> · {diff.typeLine}
                    </p>
                  </div>
                  <span className="w-12 text-center font-medium tabular-nums">
                    {diff.sourceQty}
                  </span>
                  <span className="w-12 text-center font-medium tabular-nums">
                    {diff.branchQty}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
