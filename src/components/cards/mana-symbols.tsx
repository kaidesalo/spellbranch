import type { ReactNode } from "react";
import Image from "next/image";
import {
  manaCostLabel,
  parseSymbols,
  type ManaSymbol as ManaSymbolPart,
} from "@/lib/mana";
import { cn } from "@/lib/utils";

/**
 * Mana costs and card symbols as icons. Server-safe (no hooks), so it works
 * in server pages like /favorites as well as client components.
 *
 * Icons are Scryfall's symbol SVGs vendored in /public/mana, sized to the
 * surrounding text (1em) and sitting on the baseline.
 */

/** One symbol icon. `decorative` hides it when a parent already labels the whole cost. */
export function ManaSymbol({
  symbol,
  decorative = false,
}: {
  symbol: ManaSymbolPart;
  decorative?: boolean;
}) {
  return (
    <Image
      src={`/mana/${symbol.slug}.svg`}
      alt={decorative ? "" : symbol.label}
      title={symbol.label}
      aria-hidden={decorative || undefined}
      width={16}
      height={16}
      className="mx-px inline-block size-[1em] rounded-full align-[-0.125em] shadow-[-0.05em_0.08em_0_0_rgb(75_61_68_/_0.55)]"
      unoptimized
    />
  );
}

/**
 * A Scryfall mana cost such as "{2}{B}{B}" or "{1}{R} // {1}{U}". Screen
 * readers hear the whole cost once ("Mana cost: Two generic mana, Black,
 * Black"); the icons themselves are hidden from them. Empty or null costs
 * show `fallback`.
 */
export function ManaCost({
  cost,
  fallback = null,
  className,
}: {
  cost: string | null | undefined;
  fallback?: ReactNode;
  className?: string;
}) {
  const parts = parseSymbols(cost);
  if (parts.length === 0) return <>{fallback}</>;

  return (
    <span
      role="img"
      aria-label={`Mana cost: ${manaCostLabel(cost)}`}
      className={cn("whitespace-nowrap", className)}
    >
      {parts.map((part, i) =>
        part.kind === "symbol" ? (
          <ManaSymbol key={i} symbol={part} decorative />
        ) : (
          <span key={i} aria-hidden className="whitespace-pre">
            {part.text}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * Prose with symbols inline, e.g. Oracle text "{T}: Add {B}." Each icon
 * carries its own alt text, so the sentence reads naturally. Text is
 * rendered as React text (never as HTML).
 */
export function ManaText({ text }: { text: string | null | undefined }) {
  return (
    <>
      {parseSymbols(text).map((part, i) =>
        part.kind === "symbol" ? (
          <ManaSymbol key={i} symbol={part} />
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
