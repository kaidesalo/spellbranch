import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeckCard } from "@/lib/types";

// Deck list rows: the owner gets an editable, labelled quantity input next to
// -/+ and trash; viewers only see the number.

vi.mock("@/lib/actions/decks", () => ({
  updateCardQuantityAction: vi.fn(async () => ({ success: true })),
  removeCardFromDeckAction: vi.fn(async () => ({ success: true })),
}));

const { DeckList } = await import("@/components/decks/deck-list");
const { QuantityInput } = await import("@/components/decks/quantity-input");

const swamp: DeckCard = {
  id: "c0000000-0000-4000-8000-000000000001",
  deckId: "d0000000-0000-4000-8000-000000000001",
  scryfallId: "s-swamp",
  cardName: "Swamp",
  imageUri: null,
  manaCost: null,
  typeLine: "Basic Land — Swamp",
  colors: [],
  oracleText: null,
  quantity: 7,
  createdAt: "2026-11-01T12:00:00.000Z",
} as DeckCard;

const render = (canEdit: boolean, cards = [swamp]) =>
  renderToStaticMarkup(createElement(DeckList, { deckId: swamp.deckId, cards, canEdit }));

describe("DeckList quantity", () => {
  it("the owner gets a labelled numeric input holding the quantity", () => {
    const html = render(true);
    expect(html).toMatch(/<input[^>]*aria-label="Quantity of Swamp"[^>]*>/);
    const input = html.match(/<input[^>]*>/)![0];
    expect(input).toContain('value="7"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('type="text"');
    // Same footprint and weight as the number it replaces.
    expect(input).toMatch(/class="[^"]*\bw-6\b[^"]*\btext-sm\b[^"]*\bfont-semibold\b/);
    // -/+ and trash are still there.
    for (const label of ["Decrease Swamp", "Increase Swamp", "Remove Swamp"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    // Phone rows stack the quantity controls under the name; sm+ stays one row.
    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
  });

  it("viewers see the plain number and no input or buttons", () => {
    const html = render(false);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Quantity of Swamp");
    expect(html).not.toContain("Increase Swamp");
    expect(html).toMatch(/<span class="text-sm font-semibold">7<\/span>/);
  });

  it("+ is disabled at the max so it can't ask for 100", () => {
    const html = render(true, [{ ...swamp, quantity: 99 }]);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Increase Swamp"|<button[^>]*aria-label="Increase Swamp"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Decrease Swamp"|<button[^>]*aria-label="Decrease Swamp"[^>]*disabled=""/);
  });

  it("a busy input is read-only (a save is in flight)", () => {
    const html = renderToStaticMarkup(
      createElement(QuantityInput, { cardName: "Swamp", quantity: 2, busy: true, onCommit: () => undefined }),
    );
    expect(html).toContain('readOnly=""');
    expect(html).toContain('aria-busy="true"');
  });
});
