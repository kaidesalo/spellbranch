// @vitest-environment happy-dom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeckBreakdownPanel } from "@/components/decks/deck-breakdown";
import { analyzeDeck, type BreakdownCard } from "@/lib/deck-breakdown";

afterEach(() => {
  cleanup();
});

function card(cardName: string, quantity = 1): BreakdownCard {
  return {
    cardName,
    manaCost: "{G}",
    typeLine: "Creature",
    oracleText: "Trample",
    quantity,
    board: "main",
  };
}

function readyBreakdown() {
  return analyzeDeck({
    name: "Grove",
    format: "commander",
    formatLabel: "Commander",
    colors: ["G"],
    commander: card("Grove Titan"),
    cards: [
      card("Forest", 20),
      ...Array.from({ length: 20 }, (_, index) => card(`Beast ${index}`)),
    ],
  });
}

describe("deck breakdown disclosure", () => {
  it("starts closed, and a click opens the read", () => {
    render(createElement(DeckBreakdownPanel, { breakdown: readyBreakdown() }));
    const details = screen.getByTestId("deck-breakdown") as HTMLDetailsElement;
    const summary = screen.getByTestId("deck-breakdown-summary");
    expect(details.tagName).toBe("DETAILS");
    expect(summary.tagName).toBe("SUMMARY");
    expect(details.open).toBe(false);
    expect(summary.className).toContain("focus-visible:ring-2");
    // The body stays in the document. A closed details element hides it.
    expect(screen.getByRole("heading", { name: "Overview", hidden: true })).toBeTruthy();

    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();

    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it("focuses the summary, which is what Enter and Space activate", () => {
    render(createElement(DeckBreakdownPanel, { breakdown: readyBreakdown() }));
    const summary = screen.getByTestId("deck-breakdown-summary");
    summary.focus();
    expect(document.activeElement).toBe(summary);
    // A summary has no author key handler. The browser turns Enter and
    // Space into a click. happy-dom does not, so that step is checked
    // against Chrome when the page is screenshotted.
    expect(summary.getAttribute("onkeydown")).toBeNull();
  });
});
