// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const removeFriendAction = vi.fn(async (friendshipId: string) => ({ id: friendshipId }));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
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

vi.mock("@/lib/actions/friends", () => ({
  removeFriendAction: (friendshipId: string) => removeFriendAction(friendshipId),
  respondFriendRequestAction: vi.fn(async () => ({})),
  findProfileAction: vi.fn(async () => ({ profiles: [] })),
  sendFriendRequestAction: vi.fn(async () => ({})),
}));

const { FriendsPanel } = await import("@/components/friends/friends-panel");

const friendship = {
  id: "f0000000-0000-4000-8000-000000000001",
  requesterId: "a0000000-0000-4000-8000-000000000001",
  addresseeId: "a0000000-0000-4000-8000-000000000002",
  status: "accepted" as const,
  createdAt: "2026-10-20T14:00:00.000Z",
};

const profile = {
  id: "a0000000-0000-4000-8000-000000000002",
  username: "testuser1",
  displayName: "Slave to Golgari",
  avatarUrl: null,
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  removeFriendAction.mockClear();
});

describe("friend cards", () => {
  it("links the name and handle to /u/[username] and leaves Remove outside that link", async () => {
    render(
      createElement(FriendsPanel, {
        friends: [{ friendship, profile }],
        incoming: [],
        outgoing: [],
      }),
    );

    const link = screen.getByRole("link", { name: /Slave to Golgari/ });
    expect(link.getAttribute("href")).toBe("/u/testuser1");
    expect(link.textContent).toContain("@testuser1");

    const remove = screen.getByRole("button", { name: "Remove Slave to Golgari" });
    expect(link.contains(remove)).toBe(false);

    fireEvent.click(remove);
    await waitFor(() => expect(removeFriendAction).toHaveBeenCalledWith(friendship.id));
  });
});
