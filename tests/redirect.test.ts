import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/decks/123?tab=compare#cards", "/decks/123?tab=compare#cards"],
    ["/decks/../friends", "/friends"],
    ["/%2F%2Fevil.test", "/%2F%2Fevil.test"],
  ])("keeps same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["dashboard"],
    ["https://evil.test/"],
    ["http:/evil.test"],
    ["javascript:alert(1)"],
    ["//evil.test"],
    ["//evil.test/path"],
    ["/\\evil.test"],
    ["\\\\evil.test"],
    ["/\t/evil.test"],
    ["/\n/evil.test"],
    ["/.//evil.test"],
    ["/./%2e/..//evil.test"],
    ["/" + "a".repeat(3000)],
  ])("rejects %j", (input) => {
    expect(safeNextPath(input as string | null | undefined, "/fallback")).toBe("/fallback");
  });

  it("defaults the fallback to /dashboard", () => {
    expect(safeNextPath("https://evil.test")).toBe("/dashboard");
  });
});
