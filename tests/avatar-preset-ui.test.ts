// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser, VisibleProfile } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/lib/actions/auth", () => ({
  updateProfileAction: vi.fn(async () => ({ success: true })),
  setAvatarPresetAction: vi.fn(async () => ({ success: true })),
  signOutAction: vi.fn(),
}));

const { ProfileForm } = await import("@/components/auth/profile-form");
const { UserProfile } = await import("@/components/profile/user-profile");
const { AccountMenu } = await import("@/components/layout/account-menu");

const user: SessionUser = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "ada@example.test",
  username: "ada",
  displayName: "Ada Lovelace",
};

const labels = [
  "None / use default",
  "Ghalta, Primal Hunger",
  "Lathliss, Dragon Queen",
  "Ghoulcaller Gisa",
  "Sai, Master Thopterist",
  "Giada, Font of Hope",
];

function publicProfile(over: Partial<VisibleProfile> = {}): VisibleProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: null,
    bio: "",
    ...over,
  };
}

afterEach(() => cleanup());

describe("avatar preset UI", () => {
  it("offers the presets on the edit form and not on the public profile", () => {
    render(createElement(ProfileForm, { user, bio: "", avatarPreset: "sai" }));
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual(labels);
    expect(screen.getByRole("radio", { name: "Sai, Master Thopterist" }).getAttribute("value")).toBe("sai");
    expect((screen.getByRole("radio", { name: "Sai, Master Thopterist" }) as HTMLInputElement).defaultChecked).toBe(
      true,
    );
    for (const radio of radios) {
      expect(radio.className).toContain("sr-only");
      expect(radio.closest("label")?.className).toContain("min-h-11");
    }
    cleanup();

    render(createElement(UserProfile, { profile: publicProfile(), decks: [], isSelf: false }));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shows the preset image on the account menu and the public profile", () => {
    render(createElement(AccountMenu, { user: { ...user, avatarPreset: "ghalta", avatarUrl: "https://cdn.example/a.png" } }));
    const img = screen.getByRole("img", { name: "Ghalta, Primal Hunger" });
    expect(img.getAttribute("src")).toBe("/avatars/ghalta-256.webp");
    cleanup();

    render(
      createElement(UserProfile, {
        profile: publicProfile({ avatarPreset: "giada", avatarUrl: "https://cdn.example/a.png" }),
        decks: [],
        isSelf: true,
      }),
    );
    expect(screen.getByRole("img", { name: "Giada, Font of Hope" }).getAttribute("src")).toBe(
      "/avatars/giada-512.webp",
    );
  });
});
