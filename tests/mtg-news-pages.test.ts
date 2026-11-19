import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    username: string;
    displayName: string;
  },
}));

const news = vi.hoisted(() =>
  vi.fn(async () => [
    {
      title: "Secret Lair headline",
      url: "https://magic.wizards.com/en/news/announcements/secret-lair-headline",
      date: "2026-11-18",
      excerpt: "A short excerpt.",
      category: "Announcements",
      image: null,
    },
  ]),
);

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.user,
  getRequestedUsername: async () => null,
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => {
    if (!session.user) throw new Error("NEXT_REDIRECT /login");
    return session.user;
  },
}));

vi.mock("@/lib/news/mtg-news", async () => {
  const actual = await vi.importActual<typeof import("@/lib/news/mtg-news")>("@/lib/news/mtg-news");
  return { ...actual, getMtgNews: news };
});

vi.mock("@/lib/queries/decks", () => ({
  listVisibleDecks: async () => [],
  listMyBranches: async () => [],
  listFriendBranchesOnMyDecks: async () => [],
}));

vi.mock("@/lib/queries/friends", () => ({
  getFriendsData: async () => ({ friends: [], incoming: [], outgoing: [] }),
}));

const { default: HomePage } = await import("@/app/page");
const { default: DashboardPage } = await import("@/app/dashboard/page");

const ada = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "ada@example.test",
  username: "ada",
  displayName: "Ada Lovelace",
};

function assertNewsLast(html: string, earlier: string) {
  const news = html.indexOf('data-testid="mtg-news"');
  expect(news, "news section").toBeGreaterThan(html.indexOf(earlier));
  expect(html.indexOf("<section", news)).toBe(-1);
  expect(html).toContain("Secret Lair headline");
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
}

beforeEach(() => {
  session.user = null;
  news.mockClear();
});

describe("magic news on the pages people actually see", () => {
  it("renders the section last on the signed-out home page", async () => {
    const html = renderToStaticMarkup(await HomePage());
    assertNewsLast(html, "Compare clearly");
    expect(news).toHaveBeenCalledOnce();
  });

  it("renders the same section last on the signed-in dashboard", async () => {
    session.user = ada;
    const html = renderToStaticMarkup(await DashboardPage());
    expect(html).toContain("Hey, Ada Lovelace");
    assertNewsLast(html, "Your decks");
    expect(news).toHaveBeenCalledOnce();
  });

  it("sends a signed-in visit to / away from the public home page", async () => {
    session.user = ada;
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /dashboard");
    expect(news).not.toHaveBeenCalled();
  });

  it("keeps the shared fetch on the one-hour revalidate cache", () => {
    const source = readFileSync(new URL("../src/lib/news/mtg-news.ts", import.meta.url), "utf8");
    expect(source).toMatch(/next:\s*\{\s*revalidate:\s*3600\s*\}/);
    const dashboard = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
    expect(dashboard).toContain("getMtgNews()");
    expect(dashboard).not.toMatch(/magic\.wizards\.com/);
  });
});
