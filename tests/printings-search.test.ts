import { afterEach, describe, expect, it, vi } from "vitest";
import { listCardPrintings, ScryfallLookupError } from "@/lib/scryfall/client";

const ORACLE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ID = "11111111-2222-4333-8444-555555555555";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listCardPrintings", () => {
  it("asks api.scryfall.com for prints and does not follow next_page", async () => {
    const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.origin).toBe("https://api.scryfall.com");
      expect(url.pathname).toBe("/cards/search");
      expect(url.searchParams.get("q")).toBe(`oracleid:${ORACLE}`);
      expect(url.searchParams.get("unique")).toBe("prints");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      return Response.json({
        has_more: true,
        next_page: "https://evil.example/steal",
        data: [
          {
            id: ID,
            oracle_id: ORACLE,
            name: "Lightning Bolt",
            set: "lea",
            set_name: "Limited Edition Alpha",
            collector_number: "161",
            released_at: "1993-08-05",
            finishes: ["nonfoil"],
            image_uris: { small: "https://cards.scryfall.io/small/front/x/y/card.jpg" },
          },
          {
            id: "99999999-9999-4999-8999-999999999999",
            oracle_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Not Bolt",
            set: "xxx",
            set_name: "Wrong",
            collector_number: "1",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetch);
    const first = await listCardPrintings(ORACLE);
    expect(first.map((card) => card.setCode)).toEqual(["LEA"]);
    expect(first[0]).toMatchObject({
      collectorNumber: "161",
      finishes: ["nonfoil"],
      imageUri: "https://cards.scryfall.io/small/front/x/y/card.jpg",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = fetch.mock.calls[1]![0];
    expect(second.origin).toBe("https://api.scryfall.com");
    expect(second.searchParams.get("page")).toBe("2");
    expect(String(second)).not.toContain("evil.example");
  });

  it("uses the normal image when Scryfall provides one", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        has_more: false,
        data: [
          {
            id: ID,
            oracle_id: ORACLE,
            name: "Lightning Bolt",
            set: "clu",
            set_name: "Ravnica Clue Edition",
            collector_number: "270",
            released_at: "2024-02-23",
            finishes: ["nonfoil", "foil"],
            image_uris: {
              small: "https://cards.scryfall.io/small/front/x/y/card.jpg",
              normal: "https://cards.scryfall.io/normal/front/x/y/card.jpg",
            },
          },
        ],
      }),
    );
    const [card] = await listCardPrintings(ORACLE);
    expect(card?.imageUri).toBe("https://cards.scryfall.io/normal/front/x/y/card.jpg");
  });

  it("refuses an oracle id that is not a uuid without calling Scryfall", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await listCardPrintings("not-an-id")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a failed search instead of an empty list", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    await expect(listCardPrintings(ORACLE)).rejects.toBeInstanceOf(ScryfallLookupError);
  });
});
