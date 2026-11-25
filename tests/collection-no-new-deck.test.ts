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

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => ({ id: "me", email: "me@example.test", username: "me", displayName: "Me" }),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: "me", email: "me@example.test", username: "me", displayName: "Me" }),
}));

vi.mock("@/lib/queries/decks", () => ({
  listVisibleDecks: async () => [],
  listMyBranches: async () => [],
  listPreconPage: async () => ({
    decks: [],
    total: 0,
    catalogTotal: 0,
    page: 1,
    pageCount: 1,
    years: [],
    sets: [],
  }),
}));

vi.mock("@/lib/data", () => ({
  getRepository: () => ({
    listMyCollection: async () => [],
    getCollectionVisibility: async () => "private",
    getDeck: async () => null,
  }),
}));

const { default: MyCardsPage } = await import("@/app/my-cards/page");
const { default: DecksPage } = await import("@/app/decks/page");

function hasNewDeck(html: string): boolean {
  return html.includes('href="/decks/new"');
}

describe("New deck button", () => {
  it("is hidden on every collection view and stays on branches and /decks", async () => {
    for (const view of ["full", "binders", undefined]) {
      const html = renderToStaticMarkup(
        await MyCardsPage({ searchParams: Promise.resolve({ section: "collection", view }) }),
      );
      expect(hasNewDeck(html), `collection view ${view ?? "default"}`).toBe(false);
      expect(html).toContain('href="/decks/import"');
      expect(html).toContain("Browse");
    }

    await expect(
      MyCardsPage({ searchParams: Promise.resolve({ section: "collection", view: "decks" }) }),
    ).rejects.toThrow("REDIRECT /my-cards?section=collection&view=binders");
    await expect(
      MyCardsPage({ searchParams: Promise.resolve({ section: "collection", view: "trade" }) }),
    ).rejects.toThrow("REDIRECT /my-cards?section=collection&view=binders");

    const branches = renderToStaticMarkup(
      await MyCardsPage({ searchParams: Promise.resolve({ section: "branches" }) }),
    );
    expect(hasNewDeck(branches)).toBe(true);

    const decks = renderToStaticMarkup(await DecksPage({ searchParams: Promise.resolve({}) }));
    expect(hasNewDeck(decks)).toBe(true);
  });
});
