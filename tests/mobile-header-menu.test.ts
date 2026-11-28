// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/types";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const navState = vi.hoisted(() => ({ pathname: "/", search: "" }));

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
const { ThemeProvider } = await import("@/components/theme/theme-provider");

const user: SessionUser = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "ada@example.test",
  username: "ada",
  displayName: "Ada",
};

function menuButton() {
  return screen.getByRole("button", { name: "Menu" });
}

function installColorScheme(initial: boolean) {
  const query = "(prefers-color-scheme: dark)";
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === query ? initial : false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  vi.unstubAllGlobals();
  navState.pathname = "/";
  navState.search = "";
});

describe("mobile header menu", () => {
  it("keeps the phone bar to search and a labelled menu button", () => {
    render(createElement(SiteHeader, { user: null }));
    const button = menuButton();
    const controls = button.getAttribute("aria-controls");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("type")).toBe("button");
    expect(controls).toBeTruthy();
    const panel = document.getElementById(controls!);
    expect(panel).toBeTruthy();
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect(button.className).toContain("size-11");
    expect(button.className).toContain("md:hidden");
    expect(button.className).toContain("focus-visible:ring-2");

    const search = screen.getByRole("button", { name: "Search" });
    expect(search.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(search.className).not.toContain("md:hidden");

    const theme = screen.getByTestId("theme-toggle");
    expect(theme.className).toContain("hidden");
    expect(theme.className).toContain("md:flex");
    expect(theme.querySelector("details")).toBeNull();

    const signIn = screen.getByRole("link", { name: "Sign in" });
    const join = screen.getByRole("link", { name: "Join free" });
    expect(signIn.className).toContain("hidden");
    expect(signIn.className).toContain("md:inline-flex");
    expect(join.className).toContain("hidden");
    expect(join.className).toContain("md:inline-flex");
    expect(screen.queryByRole("link", { name: "Social" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Menu" })).toBeNull();
  });

  it("moves focus into the menu, and Escape returns it to the button", () => {
    render(createElement(SiteHeader, { user: null }));
    const button = menuButton();
    fireEvent.click(button);

    const panel = screen.getByRole("region", { name: "Menu" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.id).toBe(button.getAttribute("aria-controls"));
    expect(panel.hasAttribute("hidden")).toBe(false);
    const light = within(panel).getByRole("radio", { name: "Light" });
    expect(document.activeElement).toBe(light);
    const radios = within(panel).getAllByRole("radio");
    expect(new Set(radios.map((radio) => (radio as HTMLInputElement).name)).size).toBe(1);
    expect(radios.map((radio) => (radio as HTMLInputElement).value).sort()).toEqual([
      "dark",
      "light",
      "system",
    ]);
    expect(light.closest("label")?.className).toContain("has-[:focus-visible]:ring-2");
    expect(within(panel).getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(within(panel).getByRole("link", { name: "Join free" }).getAttribute("href")).toBe("/signup");
    expect(within(panel).queryByRole("link", { name: "Social" })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Menu" })).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside tap, a menu link, and a route change", () => {
    navState.pathname = "/";
    const { rerender } = render(createElement(SiteHeader, { user: null }));
    fireEvent.click(menuButton());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Menu" })).toBeNull();

    fireEvent.click(menuButton());
    fireEvent.click(within(screen.getByRole("region", { name: "Menu" })).getByRole("link", { name: "Sign in" }));
    expect(screen.queryByRole("region", { name: "Menu" })).toBeNull();

    fireEvent.click(menuButton());
    expect(screen.getByRole("region", { name: "Menu" })).toBeTruthy();
    navState.pathname = "/login";
    rerender(createElement(SiteHeader, { user: null }));
    expect(screen.queryByRole("region", { name: "Menu" })).toBeNull();
    navState.pathname = "/";
    rerender(createElement(SiteHeader, { user: null }));
    expect(screen.queryByRole("region", { name: "Menu" })).toBeNull();
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a color choice in sync with the desktop control", () => {
    installColorScheme(false);
    render(
      createElement(ThemeProvider, null, createElement(SiteHeader, { user: null }) as ReactNode),
    );
    fireEvent.click(menuButton());
    const panel = screen.getByRole("region", { name: "Menu" });
    fireEvent.click(within(panel).getByRole("radio", { name: "Dark" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    const darks = screen.getAllByRole("radio", { name: "Dark" }) as HTMLInputElement[];
    expect(darks.length).toBeGreaterThanOrEqual(2);
    expect(darks.every((radio) => radio.checked)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(menuButton());
    const reopened = screen.getByRole("region", { name: "Menu" });
    expect((within(reopened).getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(reopened).getByRole("radio", { name: "Light" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("opens the signed-in nav on the first link and closes from there", () => {
    navState.pathname = "/dashboard";
    render(createElement(SiteHeader, { user }));
    const button = menuButton();
    const account = screen.getByRole("button", { name: "Account menu for ada" });
    expect(account.className).toContain("hidden");
    expect(account.className).toContain("md:inline-flex");
    const icon = screen
      .getAllByRole("button", { name: "Search" })
      .find((candidate) => candidate.getAttribute("aria-label") === "Search");
    expect(icon?.className).toContain("md:hidden");

    fireEvent.click(button);
    const panel = screen.getByRole("region", { name: "Menu" });
    const home = within(panel).getByRole("link", { name: "Home" });
    expect(document.activeElement).toBe(home);
    expect(within(panel).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home",
      "Collection",
      "Decks",
      "Social",
      "Profile",
      "Edit profile",
      "Favorites",
    ]);
    expect(within(panel).queryByRole("link", { name: "Search" })).toBeNull();
    expect(within(panel).queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(within(panel).getByRole("heading", { name: "Color mode" }).id).toBe("mobile-color-heading");
    expect(within(panel).getByText("@ada")).toBeTruthy();
    const signOut = within(panel).getByRole("button", { name: "Sign out" });
    expect(signOut.getAttribute("type")).toBe("submit");
    expect(signOut.closest("form")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("link", { name: "Decks" }));
    expect(screen.queryByRole("region", { name: "Menu" })).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(document.activeElement).toBe(button);
  });
});
