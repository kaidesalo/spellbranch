/**
 * Quantity rules for a deck-list row, shared by the editable quantity input
 * (client) and updateCardQuantityAction (server). No format has a per-card
 * copy limit in Spellbranch yet, so every format uses the same cap; the
 * database CHECK (deck_cards.quantity <= 99) agrees with it.
 */
export const MAX_CARD_QUANTITY = 99;

/** Caps an already-validated, non-negative integer at the max. */
export function clampQuantity(quantity: number): number {
  return Math.min(quantity, MAX_CARD_QUANTITY);
}

export type QuantityCommit =
  /** Bad input (empty, negative, decimal, not a number): show the old value. */
  | { kind: "revert" }
  /** Same as the current value: nothing to save. */
  | { kind: "unchanged" }
  /** Save this quantity (0 removes the card, like the trash button). */
  | { kind: "set"; quantity: number };

/**
 * Turns what the owner typed into a commit decision. Only plain digit
 * strings count ("3", " 03 "); anything else reverts. Large numbers are
 * capped at MAX_CARD_QUANTITY (the server caps them again).
 */
export function parseQuantityDraft(draft: string, previous: number): QuantityCommit {
  const text = draft.trim();
  if (!/^\d+$/.test(text)) return { kind: "revert" };
  const quantity = clampQuantity(Number(text));
  if (!Number.isSafeInteger(quantity)) return { kind: "revert" };
  return quantity === previous ? { kind: "unchanged" } : { kind: "set", quantity };
}

/**
 * Edit state of one quantity input. While `editing` is false the input shows
 * the row's (optimistic) quantity, so a server rollback shows up even while
 * the input still has focus.
 */
export type QuantityEditState = { editing: boolean; draft: string };

export const IDLE: QuantityEditState = { editing: false, draft: "" };

export type QuantityEditEvent =
  | { type: "change"; value: string }
  | { type: "enter" }
  | { type: "blur" }
  | { type: "escape" };

/**
 * Pure reducer for the input. Returns the next state and, for Enter/blur,
 * the commit to perform. Escape always reverts and never saves.
 */
export function quantityEditStep(
  state: QuantityEditState,
  event: QuantityEditEvent,
  current: number,
): { state: QuantityEditState; commit: QuantityCommit | null } {
  switch (event.type) {
    case "change":
      return { state: { editing: true, draft: event.value }, commit: null };
    case "escape":
      return { state: IDLE, commit: null };
    case "enter":
    case "blur":
      if (!state.editing) return { state: IDLE, commit: null };
      return { state: IDLE, commit: parseQuantityDraft(state.draft, current) };
  }
}

/** What the input displays. */
export function quantityInputValue(state: QuantityEditState, current: number): string {
  return state.editing ? state.draft : String(current);
}
