"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  IDLE,
  MAX_CARD_QUANTITY,
  quantityEditStep,
  quantityInputValue,
  type QuantityEditEvent,
  type QuantityEditState,
} from "@/lib/deck-quantity";

/**
 * The deck-list row's quantity, editable in place by the deck owner. Focus
 * selects the number; Enter or blur saves; Escape reverts. Bad input
 * (empty, negative, decimals) reverts too. Typing 0 removes the card, the
 * same as the trash button; large numbers are capped at the max.
 */
export function QuantityInput({
  cardName,
  quantity,
  busy = false,
  onCommit,
}: {
  cardName: string;
  quantity: number;
  /** A save is in flight: the value can't be edited until it settles. */
  busy?: boolean;
  onCommit: (quantity: number) => void;
}) {
  const [state, setState] = useState<QuantityEditState>(IDLE);
  const inputRef = useRef<HTMLInputElement>(null);

  function dispatch(event: QuantityEditEvent) {
    const result = quantityEditStep(state, event, quantity);
    setState(result.state);
    if (result.commit?.kind === "set") onCommit(result.commit.quantity);
    return result;
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      aria-label={`Quantity of ${cardName}`}
      title={`0 removes the card · max ${MAX_CARD_QUANTITY}`}
      readOnly={busy}
      aria-busy={busy || undefined}
      value={quantityInputValue(state, quantity)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => dispatch({ type: "change", value: e.currentTarget.value })}
      onBlur={() => dispatch({ type: "blur" })}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          dispatch({ type: "enter" });
        } else if (e.key === "Escape") {
          e.preventDefault();
          dispatch({ type: "escape" });
        } else {
          return;
        }
        // Stay in the field with the (saved or restored) number selected,
        // ready for another edit.
        const input = inputRef.current;
        requestAnimationFrame(() => input?.select());
      }}
      className={cn(
        // Looks like the plain number until hovered or focused.
        "size-9 rounded-md border border-transparent bg-transparent p-0 text-center text-sm font-medium tabular-nums text-foreground outline-none transition-colors",
        "hover:border-border focus-visible:border-ring focus-visible:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring/50",
        "selection:bg-primary selection:text-primary-foreground",
        busy && "cursor-progress opacity-70",
      )}
    />
  );
}
