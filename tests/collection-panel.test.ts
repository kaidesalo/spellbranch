// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionCard } from "@/lib/types";

const updateCard = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const setVisibility = vi.hoisted(() => vi.fn(async () => ({ success: true })));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => createElement("img", { alt: props.alt ?? "" }),
}));
vi.mock("@/lib/actions/collection", () => ({
  addCollectionCardAction: vi.fn(async () => ({ success: true })),
  importCollectionListAction: vi.fn(async () => ({ success: true, added: 0 })),
  removeCollectionCardAction: vi.fn(async () => ({ success: true })),
  setCollectionVisibilityAction: setVisibility,
  updateCollectionCardAction: updateCard,
}));

const { CollectionPanel } = await import("@/components/collection/collection-panel");

const bolt: CollectionCard = {
  id: "pile-1",
  userId: "me",
  scryfallId: "bolt",
  cardName: "Lightning Bolt",
  imageUri: null,
  manaCost: "{R}",
  typeLine: "Instant",
  quantity: 2,
  finish: "foil",
  condition: "NM",
  forTrade: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const atraxa: CollectionCard = {
  ...bolt,
  id: "atraxa",
  scryfallId: "atraxa-showcase",
  cardName: "Atraxa, Praetors' Voice",
  quantity: 1,
  finish: "nonfoil",
  forTrade: false,
  typeLine: "Legendary Creature — Phyrexian Angel",
};

afterEach(() => {
  cleanup();
  updateCard.mockClear();
  setVisibility.mockClear();
});

describe("collection panel views", () => {
  it("offers full collection and binders, with trade visibility only on binders", () => {
    render(createElement(CollectionPanel, { cards: [bolt], visibility: "friends", view: "full" }));
    expect(screen.getByRole("link", { name: "Full collection" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Binders" }).getAttribute("href")).toBe(
      "/my-cards?section=collection&view=binders",
    );
    expect(screen.queryByRole("link", { name: "In decks" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Trade binder" })).toBeNull();
    expect(screen.queryByLabelText("Collection visibility")).toBeNull();

    cleanup();
    render(
      createElement(CollectionPanel, {
        cards: [bolt, atraxa],
        visibility: "friends",
        view: "binders",
        decks: [
          { id: "d1", name: "Burn" },
          { id: "d3", name: "Atraxa" },
        ],
        memberships: [
          { deckId: "d1", deckName: "Burn", scryfallId: "bolt", cardName: "Lightning Bolt" },
          {
            deckId: "d3",
            deckName: "Atraxa",
            scryfallId: "atraxa-original",
            cardName: "Atraxa, Praetors' Voice",
          },
        ],
      }),
    );
    expect(screen.getByRole("link", { name: "Binders" }).getAttribute("aria-current")).toBe("page");
    const deckBinders = screen.getAllByTestId("deck-binder");
    expect(within(deckBinders[0]!).getByRole("link", { name: "Atraxa" }).getAttribute("href")).toBe("/decks/d3");
    expect(within(deckBinders[0]!).getByRole("heading", { name: "Atraxa, Praetors' Voice" })).toBeTruthy();
    expect(within(deckBinders[0]!).queryByRole("heading", { name: "Lightning Bolt" })).toBeNull();
    expect(within(deckBinders[1]!).getByRole("link", { name: "Burn" }).getAttribute("href")).toBe("/decks/d1");
    expect(within(deckBinders[1]!).getByRole("heading", { name: "Lightning Bolt" })).toBeTruthy();

    const trade = screen.getByTestId("trade-binder");
    expect(within(trade).getByRole("heading", { name: "Trade binder" })).toBeTruthy();
    expect(within(trade).getByLabelText("Collection visibility")).toBeTruthy();
    expect(within(trade).getByText(/Other people only see piles you mark for trade/)).toBeTruthy();
    expect(within(trade).getByRole("heading", { name: "Lightning Bolt" })).toBeTruthy();
    expect(within(trade).queryByRole("heading", { name: "Atraxa, Praetors' Voice" })).toBeNull();
    expect(deckBinders[1]!.compareDocumentPosition(trade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(within(trade).getByLabelText("Collection visibility"), { target: { value: "public" } });
    expect(setVisibility).toHaveBeenCalledWith("public");
    fireEvent.click(within(trade).getByRole("checkbox", { name: "Lightning Bolt for trade" }));
    expect(updateCard).toHaveBeenCalledWith("pile-1", {
      quantity: 2,
      finish: "foil",
      condition: "NM",
      forTrade: false,
    });
  });
});
