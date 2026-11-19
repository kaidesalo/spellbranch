// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionCard } from "@/lib/types";

const updateCard = vi.hoisted(() => vi.fn(async () => ({ success: true })));

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
  setCollectionVisibilityAction: vi.fn(async () => ({ success: true })),
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

afterEach(() => {
  cleanup();
  updateCard.mockClear();
});

describe("collection panel views", () => {
  it("shows the trade visibility setting only on the trade binder", () => {
    render(createElement(CollectionPanel, { cards: [bolt], visibility: "friends", view: "full" }));
    expect(screen.queryByLabelText("Collection visibility")).toBeNull();
    cleanup();
    render(createElement(CollectionPanel, { cards: [bolt], visibility: "friends", view: "trade" }));
    expect(screen.getByLabelText("Collection visibility")).toBeTruthy();
    expect(screen.getByText(/Other people only see piles you mark for trade/)).toBeTruthy();
  });

  it("toggles for trade through the existing pile update", () => {
    render(
      createElement(CollectionPanel, {
        cards: [bolt],
        visibility: "private",
        view: "trade",
        memberships: [{ deckId: "d1", deckName: "Burn", scryfallId: "bolt", cardName: "Lightning Bolt" }],
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Lightning Bolt for trade" }));
    expect(updateCard).toHaveBeenCalledWith("pile-1", {
      quantity: 2,
      finish: "foil",
      condition: "NM",
      forTrade: false,
    });
  });
});
