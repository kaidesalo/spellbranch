// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckWithMeta, VisibleProfile } from "@/lib/types";

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

const { UserProfile } = await import("@/components/profile/user-profile");

const T = "2026-10-20T14:00:00.000Z";

function profile(over: Partial<VisibleProfile> = {}): VisibleProfile {
  return {
    id: "a0000000-0000-4000-8000-000000000002",
    username: "bob_u",
    displayName: "Slave to Golgari",
    avatarUrl: null,
    bio: "Golgari midrange, mostly.",
    ...over,
  };
}

function deck(over: Partial<DeckWithMeta> = {}): DeckWithMeta {
  return {
    id: "d1",
    ownerId: profile().id,
    name: "Golgari Midrange",
    format: "commander",
    notes: "should not render",
    visibility: "public",
    allowForks: true,
    forkedFromId: null,
    copiedFromId: null,
    preferredBranchId: null,
    commander: null,
    colors: null,
    createdAt: T,
    updatedAt: T,
    cardCount: 99,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("UserProfile", () => {
  it("shows the name, handle, bio, initials, and decks", () => {
    render(
      createElement(UserProfile, {
        profile: profile(),
        decks: [deck(), deck({ id: "d2", name: "Friends brew", visibility: "friends" })],
        isSelf: false,
      }),
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Slave to Golgari");
    expect(screen.getByText("@bob_u")).toBeTruthy();
    expect(screen.getByTestId("profile-bio").textContent).toBe("Golgari midrange, mostly.");
    expect(screen.getByTestId("profile-avatar").textContent).toBe("SG");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link", { name: /Golgari Midrange/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Friends brew/ })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Friends only")).toBeTruthy();
    expect(document.body.textContent).not.toContain("should not render");
    expect(screen.queryByRole("link", { name: "Edit profile" })).toBeNull();
  });

  it("omits bio for a logged-out viewer and uses an https avatar", () => {
    render(
      createElement(UserProfile, {
        profile: profile({
          bio: null,
          avatarUrl: "https://cdn.example/bob.png",
        }),
        decks: [],
        isSelf: false,
      }),
    );
    expect(screen.queryByTestId("profile-bio")).toBeNull();
    expect(document.body.textContent).not.toContain("No bio yet");
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example/bob.png");
    expect(screen.getByText("No decks to show.")).toBeTruthy();
  });

  it("drops a non-https avatar and offers the owner an edit link", () => {
    render(
      createElement(UserProfile, {
        profile: profile({ bio: "  ", avatarUrl: "javascript:alert(1)" }),
        decks: [],
        isSelf: true,
      }),
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("profile-avatar").textContent).toBe("SG");
    expect(screen.getByTestId("profile-bio").textContent).toContain("No bio yet");
    expect(screen.getByRole("link", { name: "Edit profile" }).getAttribute("href")).toBe("/profile");
  });
});