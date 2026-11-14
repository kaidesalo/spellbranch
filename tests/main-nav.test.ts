// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAIN_NAV, MOBILE_MENU_NAV, mainNavActive } from "@/components/layout/main-nav";
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
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    "aria-current"?: "page";
    "aria-label"?: string;
  }) =>
    createElement(
      "a",
      { href, className, onClick, "aria-current": ariaCurrent, "aria-label": ariaLabel },
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

  it("drops Search from the mobile menu and keeps the other four in order", () => {
    expect(MOBILE_MENU_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Collection",
      "Decks",
      "Social",
    ]);
    expect(MOBILE_MENU_NAV.map((item) => item.href)).not.toContain("/browse");
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

function searchButton() {
  return screen
    .getAllByRole("button", { name: "Search" })
    .find((button) => button.getAttribute("aria-label") === "Search");
}

describe("SiteHeader nav", () => {
  it("keeps five desktop items and four mobile items, with Search only in the header icon", () => {
    navState.pathname = "/decks/deck-1/compare";
    render(createElement(SiteHeader, { user }));

    const desktop = screen.getByRole("navigation", { name: "Main" });
    expect(desktop.className).toContain("md:flex");
    const desktopItems = [...desktop.querySelectorAll("a, button")];
    expect(desktopItems.map((item) => item.textContent)).toEqual(labels);
    const desktopLinks = within(desktop).getAllByRole("link");
    expect(desktopLinks.map((link) => link.textContent)).toEqual([
      "Home",
      "Collection",
      "Decks",
      "Social",
    ]);
    expect(desktopLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/my-cards?section=collection",
      "/decks",
      "/friends",
    ]);
    expect(desktopLinks.map((link) => link.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
    ]);
    expect(within(desktop).getByRole("button", { name: "Search" }).getAttribute("aria-current")).toBeNull();

    const icon = searchButton();
    expect(icon?.tagName).toBe("BUTTON");
    expect(icon?.getAttribute("aria-label")).toBe("Search");
    expect(icon?.getAttribute("aria-current")).toBeNull();
    expect(icon?.className).toContain("size-11");
    expect(icon?.className).toContain("focus-visible:ring-2");
    expect(icon?.parentElement?.className).toContain("md:hidden");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const mobile = [...document.querySelectorAll("nav")].find((nav) => !nav.className.includes("md:flex"));
    expect(mobile).toBeTruthy();
    const mobileLinks = within(mobile!).getAllByRole("link");
    expect(mobileLinks.map((link) => link.textContent)).toEqual([
      "Home",
      "Collection",
      "Decks",
      "Social",
    ]);
    expect(mobileLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/my-cards?section=collection",
      "/decks",
      "/friends",
    ]);
    expect(within(mobile!).queryByRole("link", { name: "Search" })).toBeNull();

    expect(screen.getByRole("link", { name: "Ada" }).getAttribute("href")).toBe("/profile");
    expect(screen.getAllByRole("link", { name: "Favorites" }).length).toBeGreaterThan(0);
  });

  it("marks the header search button current only on /browse", () => {
    navState.pathname = "/browse";
    render(createElement(SiteHeader, { user }));
    const active = searchButton();
    expect(active?.getAttribute("aria-label")).toBe("Search");
    expect(active?.getAttribute("aria-current")).toBe("page");
    expect(active?.className).toContain("bg-primary");

    cleanup();
    navState.pathname = "/friends";
    render(createElement(SiteHeader, { user }));
    expect(searchButton()?.getAttribute("aria-current")).toBeNull();
    expect(searchButton()?.className.split(" ")).not.toContain("bg-primary");
  });

  it("marks Collection on the collection tab", () => {
    navState.pathname = "/my-cards";
    navState.search = "section=collection";
    render(createElement(SiteHeader, { user }));
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Collection", "Decks", "Social"]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([
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
    expect(screen.queryByRole("link", { name: "Search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });
});
