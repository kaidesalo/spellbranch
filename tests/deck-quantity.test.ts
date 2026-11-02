import { describe, expect, it } from "vitest";
import {
  IDLE,
  MAX_CARD_QUANTITY,
  clampQuantity,
  parseQuantityDraft,
  quantityEditStep,
  quantityInputValue,
  type QuantityEditEvent,
  type QuantityEditState,
} from "@/lib/deck-quantity";

// The deck list's editable quantity: what a typed value commits to, and the
// input's edit/commit/revert state machine (Enter/blur save, Escape reverts).

describe("parseQuantityDraft", () => {
  it("saves a changed whole number", () => {
    expect(parseQuantityDraft("4", 1)).toEqual({ kind: "set", quantity: 4 });
    expect(parseQuantityDraft(" 12 ", 1)).toEqual({ kind: "set", quantity: 12 });
    expect(parseQuantityDraft("007", 1)).toEqual({ kind: "set", quantity: 7 });
  });

  it("does nothing when the value didn't change", () => {
    expect(parseQuantityDraft("3", 3)).toEqual({ kind: "unchanged" });
    expect(parseQuantityDraft("03", 3)).toEqual({ kind: "unchanged" });
  });

  it("reverts empty, negative, decimal and non-numeric input", () => {
    for (const bad of ["", "   ", "-1", "-0", "1.5", "2.", ".5", "1e3", "abc", "3x", "+2", "0x10", "Infinity", "NaN", "١٢"]) {
      expect(parseQuantityDraft(bad, 3), JSON.stringify(bad)).toEqual({ kind: "revert" });
    }
  });

  it("0 removes the card (same as the trash button)", () => {
    expect(parseQuantityDraft("0", 3)).toEqual({ kind: "set", quantity: 0 });
    expect(parseQuantityDraft("000", 3)).toEqual({ kind: "set", quantity: 0 });
  });

  it("caps very large numbers at the max", () => {
    expect(MAX_CARD_QUANTITY).toBe(99);
    expect(parseQuantityDraft("100", 3)).toEqual({ kind: "set", quantity: 99 });
    expect(parseQuantityDraft("99999999999999999999999999", 3)).toEqual({ kind: "set", quantity: 99 });
    expect(parseQuantityDraft("500", 99)).toEqual({ kind: "unchanged" });
  });

  it("clampQuantity only lowers values above the max", () => {
    expect(clampQuantity(0)).toBe(0);
    expect(clampQuantity(99)).toBe(99);
    expect(clampQuantity(100)).toBe(99);
  });
});

/** Runs events through the reducer; returns the commits and the final state. */
function run(current: number, events: QuantityEditEvent[]) {
  let state: QuantityEditState = IDLE;
  const commits = [];
  for (const event of events) {
    const result = quantityEditStep(state, event, current);
    state = result.state;
    if (result.commit) commits.push(result.commit);
  }
  return { state, commits, shown: quantityInputValue(state, current) };
}

describe("quantityEditStep", () => {
  it("shows the current quantity until the owner types", () => {
    expect(quantityInputValue(IDLE, 4)).toBe("4");
    expect(run(4, [{ type: "change", value: "7" }]).shown).toBe("7");
  });

  it("Enter commits the typed value", () => {
    expect(run(1, [{ type: "change", value: "4" }, { type: "enter" }])).toEqual({
      state: IDLE,
      commits: [{ kind: "set", quantity: 4 }],
      shown: "1", // the row's optimistic quantity takes over from here
    });
  });

  it("blur commits the typed value", () => {
    expect(run(1, [{ type: "change", value: "4" }, { type: "blur" }]).commits).toEqual([
      { kind: "set", quantity: 4 },
    ]);
  });

  it("Enter then blur saves only once", () => {
    const { commits } = run(1, [{ type: "change", value: "4" }, { type: "enter" }, { type: "blur" }]);
    expect(commits).toEqual([{ kind: "set", quantity: 4 }]);
  });

  it("Escape reverts and a later blur saves nothing", () => {
    const { commits, shown } = run(2, [{ type: "change", value: "9" }, { type: "escape" }, { type: "blur" }]);
    expect(commits).toEqual([]);
    expect(shown).toBe("2");
  });

  it("focus and blur without typing saves nothing", () => {
    expect(run(2, [{ type: "blur" }]).commits).toEqual([]);
    expect(run(2, [{ type: "enter" }]).commits).toEqual([]);
  });

  it("bad input reverts to the previous value", () => {
    for (const bad of ["", "-3", "2.5", "x"]) {
      const { commits, shown } = run(2, [{ type: "change", value: bad }, { type: "blur" }]);
      expect(commits, bad).toEqual([{ kind: "revert" }]);
      expect(shown, bad).toBe("2");
    }
  });

  it("typing 0 asks for removal; a huge number is capped", () => {
    expect(run(2, [{ type: "change", value: "0" }, { type: "enter" }]).commits).toEqual([
      { kind: "set", quantity: 0 },
    ]);
    expect(run(2, [{ type: "change", value: "1000" }, { type: "enter" }]).commits).toEqual([
      { kind: "set", quantity: 99 },
    ]);
  });
});
