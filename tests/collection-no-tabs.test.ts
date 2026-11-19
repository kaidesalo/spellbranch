import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: "me", email: "me@example.test", username: "me", displayName: "Me" }),
}));

vi.mock("@/lib/queries/decks", () => ({
  listVisibleDecks: async () => [{ id: "deck-1", name: "Burn" }],
  listMyBranches: async () => [],
}));

vi.mock("@/lib/data", () => ({
  getRepository: () => ({
    listMyCollection: async () => [],
    getCollectionVisibility: async () => "private",
    getDeck: async () => ({
      id: "deck-1",
      name: "Burn",
      cards: [],
      commander: null,
    }),
  }),
}));

const { default: MyCardsPage } = await import("@/app/my-cards/page");

describe("collection page tabs", () => {
  it("does not render the Decks / Branches / Collection row", async () => {
    const html = renderToStaticMarkup(
      await MyCardsPage({ searchParams: Promise.resolve({ section: "collection" }) }),
    );
    expect(html).toContain("My cards");
    expect(html).toContain("Decks you made, branches you forked, and the cards you own.");
    expect(html).toContain("Browse");
    expect(html).toContain("Import");
    expect(html).not.toContain('href="/decks/new"');
    expect(html).toContain('data-testid="collection-views"');
    expect(html).toContain("Full collection");
    expect(html).not.toContain('data-testid="my-cards-switcher"');
    expect(html).not.toContain('data-testid="my-cards-decks"');
    expect(html).not.toContain('data-testid="my-cards-branches"');
    expect(html).not.toContain('data-testid="my-cards-collection"');
  });

  it("still lists branches at the branches route", async () => {
    const html = renderToStaticMarkup(
      await MyCardsPage({ searchParams: Promise.resolve({ section: "branches" }) }),
    );
    expect(html).toContain("No branches yet");
    expect(html).toContain('href="/my-cards?section=branches"');
  });
});
