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
const addToDeck = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const listDecks = vi.hoisted(() =>
  vi.fn(async () => ({ decks: [{ id: "d0000000-0000-4000-8000-000000000001", name: "Squirrels" }] })),
);

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => createElement("a", { href, className, "aria-label": ariaLabel }, children),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/actions/collection", () => ({
  addCollectionCardAction: addCard,
}));

vi.mock("@/lib/actions/decks", () => ({
  addCardToDeckAction: addToDeck,
  listOwnedDecksAction: listDecks,
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

const ORACLE = "c0000000-0000-4000-8000-000000000001";
const card = {
  id: "a0000000-0000-4000-8000-000000000001",
  oracle_id: ORACLE,
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
  addToDeck.mockClear();
  listDecks.mockClear();
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
    const view = screen.getByTestId("search-card-view");
    expect(view.getAttribute("data-view")).toBe("grid");
    expect(view.className).toContain("min-w-0");
    const tile = screen.getByTestId("search-card-tile");
    expect(tile.className).toContain("min-w-0");
    expect(tile.className).toContain("overflow-hidden");
    const add = screen.getByRole("button", { name: "Add Lightning Bolt to collection" });
    expect(add.className).toContain("min-w-0");
    expect(add.className).toContain("max-w-full");
    expect(add.className).not.toContain("whitespace-nowrap");
    expect(add.textContent).toBe("Add");

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("view=list"));

    fireEvent.click(add);
    await vi.waitFor(() =>
      expect(addCard).toHaveBeenCalledWith({ scryfallId: "a0000000-0000-4000-8000-000000000001" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await vi.waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Add Lightning Bolt to collection" }).length).toBe(2),
    );
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

  it("sends signed-out add actions to login with a safe return path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cards: [card], total: 1, hasMore: false })));
    render(createElement(SearchResults, { query: base, signedIn: false }));
    const signIn = await screen.findByRole("link", { name: "Sign in to add" });
    const deck = screen.getByRole("link", { name: "Add Lightning Bolt to a deck" });
    const printing = screen.getByRole("link", { name: "Change printing of Lightning Bolt" });
    for (const link of [signIn, deck, printing]) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("/login?next=")).toBe(true);
      const next = decodeURIComponent(href.slice("/login?next=".length));
      expect(next.startsWith("/search?")).toBe(true);
      expect(next.includes("q=bolt")).toBe(true);
      expect(next.includes("//")).toBe(false);
    }
  });

  it("swaps the tile to the chosen printing and adds that printing", async () => {
    const promo = "a0000000-0000-4000-8000-000000000099";
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "http://localhost").searchParams;
      if (params.get("unique") === "prints") {
        expect(params.get("q")).toBe(`oracleid:${ORACLE}`);
        return Response.json({
          cards: [
            card,
            {
              ...card,
              id: promo,
              set_name: "The List",
              image_uris: { normal: "https://cards.scryfall.io/normal/front/a/b/promo.jpg" },
            },
          ],
        });
      }
      return Response.json({ cards: [card], total: 1, hasMore: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(SearchResults, { query: base, signedIn: true }));
    expect(await screen.findByText(/Magic 2010/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change printing of Lightning Bolt" }));
    fireEvent.click(await screen.findByRole("button", { name: "The List" }));
    expect(screen.getByRole("img", { name: "Lightning Bolt" }).getAttribute("src")).toBe(
      "https://cards.scryfall.io/normal/front/a/b/promo.jpg",
    );
    expect(screen.getByTestId("search-card-tile").textContent).toContain("The List");
    fireEvent.click(screen.getByRole("button", { name: "Add Lightning Bolt to collection" }));
    await vi.waitFor(() => expect(addCard).toHaveBeenCalledWith({ scryfallId: promo }));
  });

  it("adds the current printing to a deck the picker lists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cards: [card], total: 1, hasMore: false })));
    render(createElement(SearchResults, { query: base, signedIn: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Lightning Bolt to a deck" }));
    fireEvent.click(await screen.findByRole("button", { name: "Squirrels" }));
    await vi.waitFor(() =>
      expect(addToDeck).toHaveBeenCalledWith("d0000000-0000-4000-8000-000000000001", {
        scryfallId: card.id,
        quantity: 1,
      }),
    );
    expect(listDecks).toHaveBeenCalled();
  });
});
