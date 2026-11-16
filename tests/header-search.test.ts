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
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    id?: string;
    role?: string;
    "aria-selected"?: boolean;
  }) =>
    createElement(
      "a",
      { href, className, onClick, id, role, "aria-selected": ariaSelected ? "true" : undefined },
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

  it("debounces, switches scope, and links each result type", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const scope = new URL(url, "http://localhost").searchParams.get("scope");
      if (scope === "precons") return Response.json({ sets: [sets[0]] });
      if (scope === "sets") return Response.json({ sets: [sets[1]] });
      return Response.json({
        cards: [
          { id: "card-sol", name: "Sol Ring", type_line: "Artifact", set_name: "Commander Masters" },
          { id: "card-bolt", name: "Lightning Bolt", type_line: "Instant", set_name: "Magic 2010" },
        ],
      });
    });
    render(createElement(SiteHeader, { user }));
    fireEvent.click(mobileSearchButton());
    const input = await screen.findByRole("combobox");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);

    fireEvent.change(input, { target: { value: "so" } });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("scope=cards");

    const card = screen.getByRole("option", { name: /Sol Ring/ });
    expect(card.getAttribute("href")).toBe("/my-cards?section=collection&q=Sol+Ring");
    expect(card.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const bolt = screen.getByRole("option", { name: /Lightning Bolt/ });
    expect(bolt.getAttribute("aria-selected")).toBe("true");
    expect(card.getAttribute("aria-selected")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Precons" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const precon = screen.getByRole("option", { name: /MKC/ });
    expect(precon.getAttribute("href")).toBe("/my-cards?section=collection&q=e%3Amkc&kind=precon");

    fireEvent.click(screen.getByRole("radio", { name: "Sets" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const set = screen.getByRole("option", { name: /MKM/ });
    expect(set.getAttribute("href")).toBe("/my-cards?section=collection&q=e%3Amkm&kind=set");
    expect(screen.queryByRole("option", { name: /MKC/ })).toBeNull();
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

    fireEvent.change(input, { target: { value: "sola" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText("No matches.")).toBeTruthy();
  });
});
