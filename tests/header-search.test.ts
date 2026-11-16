// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardSearchHref,
  catalogSearchHref,
  filterCatalog,
  type CatalogSet,
} from "@/lib/header-search";
import { searchScryfallCatalog } from "@/lib/scryfall/client";
import { exactCardQuery, searchPageHref } from "@/lib/search-results";
import type { SessionUser } from "@/lib/types";

const navState = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(navState.search),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    onClick,
    id,
    role,
    "aria-selected": ariaSelected,
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    id?: string;
    role?: string;
    "aria-selected"?: boolean;
    "aria-label"?: string;
  }) =>
    createElement(
      "a",
      {
        href,
        className,
        onClick,
        id,
        role,
        "aria-selected": ariaSelected ? "true" : undefined,
        "aria-label": ariaLabel,
      },
      children,
    ),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));

vi.mock("@/lib/actions/auth", () => ({
  signOutAction: vi.fn(),
}));

const { SiteHeader } = await import("@/components/layout/site-header");

const user: SessionUser = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "ada@example.test",
  username: "ada",
  displayName: "Ada",
};

const sets: CatalogSet[] = [
  {
    id: "set-mkc",
    code: "mkc",
    name: "Murders at Karlov Manor Commander",
    setType: "commander",
    releasedAt: "2024-02-09",
    cardCount: 347,
  },
  {
    id: "set-mkm",
    code: "mkm",
    name: "Murders at Karlov Manor",
    setType: "expansion",
    releasedAt: "2024-02-09",
    cardCount: 286,
  },
  {
    id: "set-dd1",
    code: "dd1",
    name: "Duel Decks: Elves vs. Goblins",
    setType: "duel_deck",
    releasedAt: "2007-11-16",
    cardCount: 62,
  },
];

function searchButtons() {
  return screen.getAllByRole("button", { name: "Search" });
}

function mobileSearchButton() {
  return searchButtons().find((button) => button.className.includes("size-11"))!;
}

beforeEach(() => {
  (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  navState.pathname = "/dashboard";
});

describe("header search destinations", () => {
  it("sends each result type to the collection add-card search", () => {
    expect(cardSearchHref("Sol Ring")).toBe("/my-cards?section=collection&q=Sol+Ring");
    expect(catalogSearchHref("mkm", "set")).toBe("/my-cards?section=collection&q=e%3Amkm&kind=set");
    expect(catalogSearchHref("mkc", "precon")).toBe(
      "/my-cards?section=collection&q=e%3Amkc&kind=precon",
    );
  });

  it("keeps precons to commander, duel, starter, and premium deck sets", () => {
    expect(filterCatalog(sets, "murders", "precons").map((set) => set.code)).toEqual(["mkc"]);
    expect(filterCatalog(sets, "murders", "sets").map((set) => set.code)).toEqual(["mkm", "mkc"]);
    expect(filterCatalog(sets, "elves", "precons").map((set) => set.code)).toEqual(["dd1"]);
    expect(filterCatalog(sets, "e", "sets")).toEqual([]);
  });
});

describe("Scryfall catalog", () => {
  it("reads the cached set list with Scryfall's headers and filters precons locally", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.scryfall.com/sets");
      expect(new URL(String(url)).search).toBe("");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Accept).toBe("application/json");
      expect(headers["User-Agent"]).toContain("Spellbranch");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      return Response.json({
        data: [
          {
            id: "set-mkc",
            code: "mkc",
            name: "Murders at Karlov Manor Commander",
            set_type: "commander",
            released_at: "2024-02-09",
            card_count: 347,
          },
          {
            id: "set-mkm",
            code: "mkm",
            name: "Murders at Karlov Manor",
            set_type: "expansion",
            released_at: "2024-02-09",
            card_count: 286,
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchScryfallCatalog("murders", "precons");
    expect(result.error).toBeUndefined();
    expect(result.sets.map((set) => set.code)).toEqual(["mkc"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("search dialog", () => {
  it("opens from the mobile icon and the desktop Search item, and closes with Esc back to that control", async () => {
    render(createElement(SiteHeader, { user }));
    const mobile = mobileSearchButton();
    mobile.focus();
    fireEvent.click(mobile);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("Search Spellbranch")).toBeTruthy();
    const input = within(dialog).getByRole("combobox", { name: "Search for cards, precons, and sets" });
    expect(input.getAttribute("placeholder")).toBe("Search for cards, precons, and sets");
    expect(within(dialog).getByRole("button", { name: "Close search" }).className).toContain("size-11");
    expect(within(dialog).getByRole("link", { name: "Browse decks" }).getAttribute("href")).toBe("/browse");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(mobile);

    fireEvent.click(screen.getByRole("navigation", { name: "Main" }).querySelector("button")!);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("suggests scopes first, then card names, and routes Enter to the highlighted line", async () => {
    const fetchMock = vi.fn(async () => Response.json({ names: ["Sol Ring", "Lightning Bolt"] }));
    render(createElement(SiteHeader, { user }));
    fireEvent.click(mobileSearchButton());
    const input = await screen.findByRole("combobox");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);

    fireEvent.change(input, { target: { value: "so" } });
    const cardsLine = screen.getByRole("option", { name: "so in Cards" });
    expect(cardsLine.getAttribute("aria-selected")).toBe("true");
    expect(cardsLine.getAttribute("href")).toBe(searchPageHref({ q: "so", type: "cards" }));
    expect(screen.getByRole("option", { name: "so in Precons" }).getAttribute("href")).toBe(
      searchPageHref({ q: "so", type: "precons" }),
    );
    expect(screen.getByRole("option", { name: "so in Sets" }).getAttribute("href")).toBe(
      searchPageHref({ q: "so", type: "sets" }),
    );
    expect(screen.getByRole("link", { name: "Search cards" }).getAttribute("href")).toBe(
      searchPageHref({ q: "so", type: "cards" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(String((fetchMock.mock.calls as unknown as unknown[][])[0]?.[0])).toContain("scope=autocomplete");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const name = screen.getByRole("option", { name: "Sol Ring" });
    expect(name.getAttribute("aria-selected")).toBe("true");
    expect(name.getAttribute("href")).toBe(searchPageHref({ q: exactCardQuery("Sol Ring"), type: "cards" }));
    expect(exactCardQuery("Sol Ring")).toBe('!"Sol Ring"');
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an error and an empty result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "Could not reach Scryfall" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ cards: [] }));
    render(createElement(SiteHeader, { user }));
    fireEvent.click(mobileSearchButton());
    const input = await screen.findByRole("combobox");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.change(input, { target: { value: "sol" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText("Could not reach Scryfall")).toBeTruthy();
    expect(screen.getByRole("option", { name: "sol in Cards" })).toBeTruthy();

    fireEvent.change(input, { target: { value: "sola" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole("option", { name: "sola in Sets" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Sol Ring" })).toBeNull();
  });

  it("builds a card query from the advanced filters and still links to collection", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        cards: [{ id: "card-bolt", name: "Lightning Bolt", type_line: "Instant", set_name: "Magic 2010" }],
      }),
    );
    render(createElement(SiteHeader, { user }));
    fireEvent.click(mobileSearchButton());
    await screen.findByRole("dialog");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);

    fireEvent.click(screen.getByRole("button", { name: /Advanced filters/ }));
    expect(screen.getByText("Add filters to build a query.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Modern" }));
    fireEvent.click(screen.getAllByText("Colors")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    expect(screen.getByText("f:modern c=w")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search with these filters" }).getAttribute("href")).toBe(
      searchPageHref({ q: "f:modern c=w", type: "cards" }),
    );
  });
});
