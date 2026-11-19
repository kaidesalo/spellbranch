// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  user: { id: "me", email: "me@example.test", username: "me", displayName: "Me" } as
    | { id: string; email: string; username: string; displayName: string }
    | null,
}));
const calls = vi.hoisted(() => [] as string[]);

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.user,
}));

vi.mock("@/lib/queries/decks", () => ({
  listVisibleDecks: async (scope: string) => {
    calls.push(scope);
    if (scope === "public") return [{ id: "pub", name: "Open List", visibility: "public" }];
    if (scope === "mine") return [{ id: "mine", name: "Secret List", visibility: "private" }];
    throw new Error(`unexpected scope ${scope}`);
  },
}));

vi.mock("@/components/decks/deck-grid", () => ({
  DeckGrid: ({ decks }: { decks: { name: string; visibility: string }[] }) =>
    createElement(
      "ul",
      null,
      decks.map((deck) => createElement("li", { key: deck.name }, `${deck.name} ${deck.visibility}`)),
    ),
  DeckEmpty: ({ title, href, cta }: { title: string; href?: string; cta?: string }) =>
    createElement("div", null, createElement("h2", null, title), href ? createElement("a", { href }, cta) : null),
}));

const { decksTab, default: DecksPage } = await import("@/app/decks/page");
const { default: MyCardsPage } = await import("@/app/my-cards/page");

beforeEach(() => {
  session.user = { id: "me", email: "me@example.test", username: "me", displayName: "Me" };
  calls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("decks tabs", () => {
  it("defaults to my decks when signed in and public decks when signed out", () => {
    expect(decksTab(undefined, true)).toBe("mine");
    expect(decksTab("public", true)).toBe("public");
    expect(decksTab(undefined, false)).toBe("public");
    expect(decksTab("mine", false)).toBe("mine");
  });

  it("shows only my decks or public decks, never collection", async () => {
    render(await DecksPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Branches" }).getAttribute("href")).toBe(
      "/my-cards?section=branches",
    );
    expect(screen.getByRole("link", { name: /My decks/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Secret List private")).toBeTruthy();
    expect(screen.queryByText("Open List public")).toBeNull();
    expect(screen.queryByRole("link", { name: "Collection" })).toBeNull();
    expect(screen.queryByText(/collection/i)).toBeNull();
    expect(calls).toEqual(["mine", "public"]);

    cleanup();
    calls.length = 0;
    render(await DecksPage({ searchParams: Promise.resolve({ tab: "public" }) }));
    expect(screen.getByRole("link", { name: /Public decks/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Open List public")).toBeTruthy();
    expect(screen.queryByText("Secret List private")).toBeNull();
    expect(calls).toEqual(["mine", "public"]);
  });

  it("asks a signed-out visitor to sign in for my decks and only queries public decks", async () => {
    session.user = null;
    render(await DecksPage({ searchParams: Promise.resolve({ tab: "mine" }) }));
    const link = screen.getByRole("link", { name: "Sign in" });
    const next = decodeURIComponent(link.getAttribute("href")?.split("next=")[1] ?? "");
    expect(next).toBe("/decks");
    expect(screen.getByRole("heading", { name: "Sign in to see your decks" })).toBeTruthy();
    expect(calls).toEqual(["public"]);
    expect(calls).not.toContain("mine");
    expect(calls).not.toContain("friends");
  });
});

describe("old my cards decks URL", () => {
  it("redirects the decks section to /decks", async () => {
    await expect(MyCardsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /decks");
    await expect(MyCardsPage({ searchParams: Promise.resolve({ section: "decks" }) })).rejects.toThrow(
      "REDIRECT /decks",
    );
  });
});
