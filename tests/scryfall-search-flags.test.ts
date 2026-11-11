import { afterEach, describe, expect, it, vi } from "vitest";
import { SCRYFALL_COLLECTION_MAX_BYTES, searchScryfallCards } from "@/lib/scryfall/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchScryfallCards", () => {
  it("does not follow redirects, omits cookies, and caps the body at 2 MB", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      return Response.json({ object: "list", total_cards: 1, data: [{ id: "x", name: "Bolt" }] });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await searchScryfallCards("bolt");
    expect(result.cards).toHaveLength(1);
    expect(result.error).toBeUndefined();
    expect(String(fetch.mock.calls[0]?.[0])).toContain("https://api.scryfall.com/cards/search");

    fetch.mockImplementationOnce(async () => {
      return new Response("too big", {
        status: 200,
        headers: { "content-length": String(SCRYFALL_COLLECTION_MAX_BYTES + 1) },
      });
    });
    const huge = await searchScryfallCards("bolt");
    expect(huge).toEqual({
      cards: [],
      total: 0,
      error: "Scryfall sent an unexpected answer. Try again in a moment.",
    });

    fetch.mockImplementationOnce(async () => {
      throw new TypeError("redirect");
    });
    const redirected = await searchScryfallCards("bolt");
    expect(redirected).toEqual({ cards: [], total: 0, error: "Could not reach Scryfall" });
  });
});
