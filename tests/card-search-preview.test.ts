import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The empty preview is always in the tree (desktop sidebar keeps the slab)
// but hidden below the lg breakpoint until a card is selected.

vi.mock("@/lib/actions/decks", () => ({
  addCardToDeckAction: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/actions/favorites", () => ({
  addFavoriteAction: vi.fn(async () => ({ success: true })),
}));

const { CardSearch } = await import("@/components/cards/card-search");

describe("CardSearch empty preview", () => {
  it("hides the placeholder below lg until a card is selected", () => {
    const html = renderToStaticMarkup(
      createElement(CardSearch, {
        deckId: "22222222-2222-4222-8222-222222222222",
        canEdit: true,
        deckColors: ["B"],
      }),
    );
    expect(html).toContain("Card preview");
    const placeholder = html.slice(html.indexOf("Card preview") - 400, html.indexOf("Card preview"));
    expect(placeholder).toContain("hidden");
    expect(placeholder).toContain("lg:block");
    expect(placeholder).not.toContain("max-w-[11rem]");
  });
});
