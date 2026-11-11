import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("robots.txt", () => {
  it("disallows public profiles and the signed-in collection", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        disallow: ["/u/", "/my-cards"],
      },
    });
  });
});
