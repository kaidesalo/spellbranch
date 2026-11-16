import { beforeEach, describe, expect, it, vi } from "vitest";

let signedIn = false;
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => {
    if (!signedIn) throw new Error("NEXT_REDIRECT /login");
    return { id: "a0000000-0000-4000-8000-000000000001", email: "a@example.test", username: "a", displayName: "A" };
  },
}));

const forkDeck = vi.fn();
vi.mock("@/lib/data", () => ({
  getRepository: () => ({ forkDeck }),
}));

const { forkDeckAction } = await import("@/lib/actions/decks");

beforeEach(() => {
  signedIn = false;
  forkDeck.mockReset();
});

describe("forkDeckAction", () => {
  it("rejects a signed-out caller before forking", async () => {
    const form = new FormData();
    form.set("name", "Branch");
    await expect(forkDeckAction("d0000000-0000-4000-8000-000000000001", form)).rejects.toThrow(
      "NEXT_REDIRECT /login",
    );
    expect(forkDeck).not.toHaveBeenCalled();
  });
});
