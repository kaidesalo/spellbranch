import Image from "next/image";
import { FINISH_LABEL, type CollectionFinish } from "@/lib/collection";
import type { CardPrinting } from "@/lib/scryfall/client";
import { cn } from "@/lib/utils";

/** At least 9rem, so a 375px phone fits two columns. Tracks grow to fill the row. */
export const PRINTING_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] justify-center gap-3";

export function PrintingSkeleton() {
  return (
    <div data-testid="printing-skeleton" aria-busy="true" className={PRINTING_GRID_CLASS}>
      <p className="sr-only">Loading printings</p>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-border/80 bg-background/60">
          <div className="aspect-[63/88] w-full animate-pulse bg-muted" />
          <div className="space-y-2 p-2">
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function printingLabel(printing: CardPrinting, current: boolean, chooseFinish: boolean): string {
  const identity = `${printing.setName}${printing.setCode ? ` (${printing.setCode})` : ""} #${printing.collectorNumber || "unknown"}`;
  if (current) return `Current printing, ${identity}`;
  if (chooseFinish && printing.finishes.length > 1) return `Choose a finish for ${identity}`;
  if (chooseFinish && printing.finishes.length === 0) return `No finish available for ${identity}`;
  return `Use ${identity}`;
}

export function PrintingGrid({
  printings,
  currentId,
  busy,
  chooseFinish,
  pickedId,
  onTile,
  onFinish,
}: {
  printings: CardPrinting[];
  currentId: string | null;
  busy: boolean;
  chooseFinish: boolean;
  pickedId: string | null;
  onTile: (printing: CardPrinting) => void;
  onFinish: (printing: CardPrinting, finish: CollectionFinish) => void;
}) {
  return (
    <ul className={PRINTING_GRID_CLASS} data-testid="printing-grid">
      {printings.map((printing) => {
        const current = printing.id === currentId;
        const finishes = printing.finishes.map((finish) => FINISH_LABEL[finish]).join(", ");
        const showFinishes = chooseFinish && pickedId === printing.id && printing.finishes.length > 1;
        const blocked = busy || (chooseFinish && !current && printing.finishes.length === 0);
        return (
          <li
            key={printing.id}
            className={cn(
              "flex w-full min-w-0 max-w-[12.5rem] flex-col justify-self-center overflow-hidden rounded-xl border bg-background/60 transition-colors",
              current
                ? "border-primary ring-2 ring-primary"
                : "border-border/80 hover:border-primary/80 hover:bg-background",
            )}
          >
            <button
              type="button"
              data-testid="printing-option"
              aria-current={current ? "true" : undefined}
              aria-expanded={chooseFinish && printing.finishes.length > 1 ? showFinishes : undefined}
              aria-label={printingLabel(printing, current, chooseFinish)}
              disabled={blocked}
              onClick={() => onTile(printing)}
              className={cn(
                "flex min-w-0 flex-1 flex-col text-left outline-none",
                "focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                "disabled:opacity-60",
              )}
            >
              <span className="relative block aspect-[63/88] w-full bg-muted">
                {printing.imageUri ? (
                  <Image
                    src={printing.imageUri}
                    alt={`${printing.setName} #${printing.collectorNumber || "unknown"}`}
                    fill
                    sizes="(max-width: 430px) 46vw, 200px"
                    loading="lazy"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs text-muted-foreground">
                    No image
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 p-2">
                {current && (
                  <span className="mb-1 w-fit rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    Current
                  </span>
                )}
                <span className="text-sm leading-snug font-medium break-words">
                  {printing.setName}
                  {printing.setCode ? ` (${printing.setCode})` : ""}
                </span>
                <span className="text-xs break-words text-muted-foreground">
                  #{printing.collectorNumber || "—"}
                </span>
                {printing.releasedAt && (
                  <span className="text-xs break-words text-muted-foreground">{printing.releasedAt}</span>
                )}
                {finishes && <span className="text-xs break-words text-muted-foreground">{finishes}</span>}
              </span>
            </button>
            {showFinishes && (
              <span className="flex min-w-0 flex-wrap gap-1.5 px-2 pb-2">
                {printing.finishes.map((finish) => (
                  <button
                    key={finish}
                    type="button"
                    data-testid="printing-finish"
                    disabled={busy}
                    onClick={() => onFinish(printing, finish)}
                    className="rounded-lg border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground outline-none hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {FINISH_LABEL[finish]}
                  </button>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
