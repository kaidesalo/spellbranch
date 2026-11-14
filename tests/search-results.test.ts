// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEARCH_RESULT_CAP,
  buildSuggestions,
  exactCardQuery,
  parseSearchPageQuery,
  reachedSearchCap,
  searchPageHref,
} from "@/lib/search-results";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const addCard = vi.hoisted(() => vi.fn(async () => ({ success: true })));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/actions/collection", () => ({
  addCollectionCardAction: addCard,
}));

const { SearchResults } = await import("@/components/search/search-results");

const base = {
  q: "bolt",
  type: "cards" as const,
  order: "",
  dir: "",
  unique: "" as const,
  view: "grid" as const,
};

const card = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Lightning Bolt",
  type_line: "Instant",
  set_name: "Magic 2010",
  image_uris: { normal: "https://cards.scryfall.io/normal/front/a/b/bolt.jpg" },
};

afterEach(() => {
  cleanup();
  nav.push.mockClear();
  nav.replace.mockClear();
  addCard.mockClear();
  vi.unstubAllGlobals();
});

describe("search page model", () => {
  it("parses the URL and builds exact-name and scope links", () => {
    expect(parseSearchPageQuery({ q: " crypt ", type: "sets", view: "list", unique: "prints" })).toEqual({
      q: "crypt",
      type: "sets",
      order: "",
      dir: "",
      unique: "prints",
      view: "list",
    });
    expect(parseSearchPageQuery({ type: "nope" }).type).toBe("cards");
    expect(exactCardQuery('Sol "Ring"')).toBe('!"Sol \\"Ring\\""');
    expect(searchPageHref({ q: exactCardQuery("Sol Ring"), type: "cards" })).toContain("type=cards");
    expect(buildSuggestions("so", ["Sol Ring"])[0]?.label).toBe("so in Cards");
    expect(reachedSearchCap(10, true)).toBe(true);
    expect(reachedSearchCap(10, false)).toBe(false);
    expect(SEARCH_RESULT_CAP).toBe(1750);
  });
});

describe("SearchResults", () => {
  it("shows the count, toggles the layout, loads another page, and adds a card", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url, "http://localhost").searchParams.get("page");
      return Response.json({
        cards: [{ ...card, id: `a0000000-0000-4000-8000-00000000000${page}` }],
        total: 2,
        hasMore: page === "1",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(SearchResults, { query: base, signedIn: true }));
    expect(await screen.findByText(/returned 2 results/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/search");
    const image = screen.getByRole("img", { name: "Lightning Bolt" });
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("width")).toBe("244");
    expect(screen.getByTestId("search-card-view").getAttribute("data-view")).toBe("grid");

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("view=list"));

    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    await vi.waitFor(() =>
      expect(addCard).toHaveBeenCalledWith({ scryfallId: "a0000000-0000-4000-8000-000000000001" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("button", { name: "Add to collection" });
    expect(String((fetchMock.mock.calls as unknown as unknown[][])[1]?.[0])).toContain("page=2");
  });

  it("lists precon sets and stops at the page cap", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const type = new URL(url, "http://localhost").searchParams.get("scope");
      if (type === "precons") {
        return Response.json({
          sets: [
            {
              id: "set-mkc",
              code: "mkc",
              name: "Murders at Karlov Manor Commander",
              setType: "commander",
              releasedAt: "2024-02-09",
              cardCount: 347,
            },
          ],
        });
      }
      const page = Number(new URL(url, "http://localhost").searchParams.get("page") ?? "1");
      return Response.json({
        cards: [
          {
            ...card,
            id: `b0000000-0000-4000-8000-${String(page).padStart(12, "0")}`,
            name: `Bolt ${page}`,
          },
        ],
        total: 2000,
        hasMore: true,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      createElement(SearchResults, { query: { ...base, q: "karlov", type: "precons" }, signedIn: false }),
    );
    expect(await screen.findByText("Murders at Karlov Manor Commander")).toBeTruthy();
    expect(screen.getByTestId("search-set-list")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Murders at Karlov Manor Commander/ }).getAttribute("href")).toBe(
      searchPageHref({ q: "e:mkc", type: "cards" }),
    );
    unmount();

    render(createElement(SearchResults, { query: { ...base, q: "angel" }, signedIn: true }));
    await screen.findByRole("button", { name: "Load more" });
    for (let i = 0; i < 9; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await screen.findByText(`Bolt ${i + 2}`);
    }
    expect(screen.getByText(/Showing the first 1,750 cards/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
