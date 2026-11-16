// @vitest-environment happy-dom

import { existsSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

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

vi.mock("@/lib/actions/auth", () => ({
  signOutAction: vi.fn(),
}));

const { AccountMenu, accountMenuItems } = await import("@/components/layout/account-menu");

(globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;

const user: SessionUser = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "ada@example.test",
  username: "ada",
  displayName: "Ada Lovelace",
};

function pageFor(href: string): string {
  if (href.startsWith("/u/")) return "src/app/u/[username]/page.tsx";
  return `src/app${href}/page.tsx`;
}

afterEach(() => {
  cleanup();
});

describe("account menu routes", () => {
  it("points only at pages that exist, with profile before favorites", () => {
    const items = accountMenuItems("ada");
    expect(items.map((item) => item.label)).toEqual(["Profile", "Edit profile", "Favorites"]);
    expect(items.map((item) => item.href)).toEqual(["/u/ada", "/profile", "/favorites"]);
    for (const item of items) {
      expect(existsSync(pageFor(item.href)), item.href).toBe(true);
    }
  });
});

describe("AccountMenu", () => {
  it("shows initials when there is no usable picture", () => {
    const { rerender } = render(createElement(AccountMenu, { user }));
    const button = screen.getByRole("button", { name: "Account menu for ada" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toBe("AL");
    expect(button.querySelector("img")).toBeNull();

    rerender(createElement(AccountMenu, { user: { ...user, avatarUrl: "http://cdn.example/a.png" } }));
    expect(screen.getByRole("button", { name: "Account menu for ada" }).querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Account menu for ada" }).textContent).toBe("AL");
  });

  it("uses a plain img for an https avatar", () => {
    render(
      createElement(AccountMenu, {
        user: { ...user, avatarUrl: "https://cdn.example/ada.png" },
      }),
    );
    const img = screen.getByRole("button", { name: "Account menu for ada" }).querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example/ada.png");
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("lists the real routes and puts Sign out last", () => {
    render(createElement(AccountMenu, { user }));
    fireEvent.click(screen.getByRole("button", { name: "Account menu for ada" }));
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Profile",
      "Edit profile",
      "Favorites",
      "Sign out",
    ]);
    expect(items.slice(0, 3).map((item) => item.getAttribute("href"))).toEqual([
      "/u/ada",
      "/profile",
      "/favorites",
    ]);
    const signOut = items[3];
    expect(signOut.tagName).toBe("BUTTON");
    expect(signOut.getAttribute("type")).toBe("submit");
    expect(signOut.closest("form")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account menu for ada" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("moves with arrows, Home, and End, and Escape returns focus to the button", () => {
    render(createElement(AccountMenu, { user }));
    const button = screen.getByRole("button", { name: "Account menu for ada" });
    fireEvent.click(button);
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    items[0].focus();

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: "End" });
    expect(document.activeElement).toBe(items[3]);

    fireEvent.keyDown(items[3], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside click and returns focus to the button", () => {
    render(createElement(AccountMenu, { user }));
    const button = screen.getByRole("button", { name: "Account menu for ada" });
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});
