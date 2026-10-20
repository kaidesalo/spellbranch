import { describe, expect, it } from "vitest";
import { usernameChangedNotice } from "@/lib/auth/username-notice";

// Review N2: tell the user when the database suffixed their username.
describe("usernameChangedNotice", () => {
  it("says nothing when the name is unchanged (any case) or unknown", () => {
    expect(usernameChangedNotice("Planeswalker", "planeswalker")).toBeNull();
    expect(usernameChangedNotice(null, "player_1a2b3c")).toBeNull();
    expect(usernameChangedNotice(undefined, "x_y")).toBeNull();
    expect(usernameChangedNotice("", "x_y")).toBeNull();
  });

  it("names both the requested and the final username", () => {
    expect(usernameChangedNotice("walker", "walker_9f3e")).toBe(
      "@walker was taken by the time your account was created, so your username is @walker_9f3e.",
    );
  });
});
