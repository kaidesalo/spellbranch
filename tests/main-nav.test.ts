// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAIN_NAV, mainNavActive } from "@/components/layout/main-nav";
import type { SessionUser } from "@/lib/types";

const navState = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(navState.search),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    onClick,
    "aria-current": ariaCurrent,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    "aria-current"?: "page";
  }) => createElement("a", { href, className, onClick, "aria-current": ariaCurrent }, children),
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

const labels = ["Home", "Search", "Collection", "Decks", "Social"];
const hrefs = ["/dashboard", "/browse", "/my-cards?section=collection", "/decks", "/friends"];

afterEach(() => {
  cleanup();
  navState.pathname = "/dashboard";
  navState.search = "";
});

describe("main nav model", () => {
  it("lists exactly five items in order", () => {
    expect(MAIN_NAV.map((item) => item.label)).toEqual(labels);
    expect(MAIN_NAV.map((item) => item.href)).toEqual(hrefs);
  });

  it("highlights the section for nested routes and leaves the others off", () => {
    expect(mainNavActive("/decks/deck-1", "/decks")).toBe(true);
    expect(mainNavActive("/decks/deck-1/edit", "/decks")).toBe(true);
    expect(mainNavActive("/decks/deck-1/compare", "/decks")).toBe(true);
    expect(mainNavActive("/decks/new", "/decks")).toBe(true);
    expect(mainNavActive("/decks/import", "/decks")).toBe(true);
    expect(mainNavActive("/my-cards", "/decks", null)).toBe(true);
    expect(mainNavActive("/my-cards", "/decks", "branches")).toBe(true);
    expect(mainNavActive("/my-cards", "/decks", "collection")).toBe(false);
    expect(mainNavActive("/my-cards", "/my-cards?section=collection", "collection")).toBe(true);
    expect(mainNavActive("/my-cards", "/my-cards?section=collection", "decks")).toBe(false);
    expect(mainNavActive("/browse?scope=public", "/browse")).toBe(true);
    expect(mainNavActive("/friends", "/friends")).toBe(true);
    expect(mainNavActive("/dashboard", "/dashboard")).toBe(true);
    expect(mainNavActive("/profile", "/friends")).toBe(false);
    expect(mainNavActive("/favorites", "/my-cards?section=collection")).toBe(false);
    expect(mainNavActive("/", "/dashboard")).toBe(false);
  });
});

describe("SiteHeader nav", () => {
  it("renders the five items in both menus and marks the active route", () => {
    navState.pathname = "/decks/deck-1/compare";
    render(createElement(SiteHeader, { user }));
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const navs = screen.getAllByRole("navigation", { name: "Main" });
    expect(navs.length).toBeGreaterThanOrEqual(1);
    for (const nav of navs) {
      const links = within(nav).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(labels);
      expect(links.map((link) => link.getAttribute("href"))).toEqual(hrefs);
      expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([
        null,
        null,
        null,
        "page",
        null,
      ]);
    }
    const headerSource = readFileSync(
      path.join(process.cwd(), "src/components/layout/site-header.tsx"),
      "utf8",
    );
    expect(headerSource.match(/aria-label="Main"/g)).toHaveLength(2);
    expect(headerSource.match(/<NavLinks/g)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Ada" }).getAttribute("href")).toBe("/profile");
    expect(screen.getAllByRole("link", { name: "Favorites" }).length).toBeGreaterThan(0);
  });

  it("marks Collection on the collection tab", () => {
    navState.pathname = "/my-cards";
    navState.search = "section=collection";
    render(createElement(SiteHeader, { user }));
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
      null,
    ]);
  });

  it("keeps signed-out visitors on sign in and join, without the main nav", () => {
    render(createElement(SiteHeader, { user: null }));
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Join free" }).getAttribute("href")).toBe("/signup");
    expect(screen.queryByRole("link", { name: "Social" })).toBeNull();
  });
});
