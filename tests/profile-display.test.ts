import { describe, expect, it } from "vitest";
import { profileInitials, safeAvatarUrl } from "@/lib/profile-display";

describe("profileInitials", () => {
  it("uses the first and last word of a display name", () => {
    expect(profileInitials("Slave to Golgari", "testuser1")).toBe("SG");
  });

  it("uses the first two letters of a single word", () => {
    expect(profileInitials("Cmen", "Seamen369")).toBe("CM");
  });

  it("falls back to the username when the display name is blank", () => {
    expect(profileInitials("   ", "bob_u")).toBe("BO");
  });
});

describe("safeAvatarUrl", () => {
  it("keeps a plain https URL", () => {
    expect(safeAvatarUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
  });

  it("drops missing, non-https, credentialed, and unparsable URLs", () => {
    expect(safeAvatarUrl(null)).toBeNull();
    expect(safeAvatarUrl("")).toBeNull();
    expect(safeAvatarUrl("http://cdn.example/a.png")).toBeNull();
    expect(safeAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(safeAvatarUrl("data:image/png;base64,aaaa")).toBeNull();
    expect(safeAvatarUrl("https://user:pass@cdn.example/a.png")).toBeNull();
    expect(safeAvatarUrl("not a url")).toBeNull();
  });
});
