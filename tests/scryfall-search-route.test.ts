import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";
import { clearScryfallSetCacheForTests } from "@/lib/scryfall/client";

// Cipher PR #9 L2: the public search proxy is limited per IP (60/min) before
// it calls Scryfall, and its Scryfall fetch has a timeout. Stubbed fetch.

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { GET } = await import("@/app/api/scryfall/search/route");

const search = (q = "test legend") => GET(new Request(`http://localhost/api/scryfall/search?q=${encodeURIComponent(q)}`));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  requestHeaders = new Headers({ "x-real-ip": "203.0.113.20" });
  fetchMock = vi.fn(async () => Response.json({ object: "list", total_cards: 0, data: [] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/scryfall/search", () => {
  it("allows 60 searches per IP per minute, then 429 with Retry-After and no Scryfall call", async () => {
    for (let i = 0; i < 60; i++) expect((await search()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(60);
    const res = await search();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ error: RATE_LIMITED_MESSAGE, retryAfterSec: 60 });
    expect(fetchMock).toHaveBeenCalledTimes(60);
    requestHeaders = new Headers({ "x-real-ip": "198.51.100.20" });
    expect((await search()).status).toBe(200);
  });

  it("rejects an overlong query and a bad page with 400 before Scryfall", async () => {
    const emoji = "😀".repeat(201);
    const long = await GET(new Request(`http://localhost/api/scryfall/search?q=${encodeURIComponent(emoji)}`));
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "Search query is too long" });

    const allowed = await GET(
      new Request(`http://localhost/api/scryfall/search?q=${encodeURIComponent("😀".repeat(150))}`),
    );
    expect(allowed.status).toBe(200);

    for (const page of ["Infinity", "-1", "1.5", "0", "11", "01"]) {
      const res = await GET(new Request(`http://localhost/api/scryfall/search?q=bolt&page=${page}`));
      expect(res.status, page).toBe(400);
      expect(await res.json()).toEqual({ error: "Page is invalid" });
    }
    const page = await GET(new Request("http://localhost/api/scryfall/search?q=bolt&page=2"));
    expect(page.status).toBe(200);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("page=2");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("page=Infinity"))).toBe(false);
  });

  it("still rate-limits a query the route rejects", async () => {
    requestHeaders = new Headers({ "x-real-ip": "203.0.113.77" });
    const huge = "a".repeat(201);
    for (let i = 0; i < 60; i++) {
      const res = await GET(new Request(`http://localhost/api/scryfall/search?q=${huge}`));
      expect(res.status).toBe(400);
    }
    const blocked = await GET(new Request(`http://localhost/api/scryfall/search?q=${huge}`));
    expect(blocked.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces Scryfall error details with a fixed message", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ details: "Expected 'or' but found 'evil.example'" }, { status: 400 }),
    );
    const res = await search("f:(");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "Scryfall search failed" });
    expect(JSON.stringify(body)).not.toContain("evil.example");
  });

  it("caches the set list only after a 200", async () => {
    clearScryfallSetCacheForTests();
    requestHeaders = new Headers({ "x-real-ip": "203.0.113.88" });
    const query = "http://localhost/api/scryfall/search?q=murders&scope=sets";
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const failed = await GET(new Request(query));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "Scryfall search failed" });

    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            id: "set-mkm",
            code: "mkm",
            name: "Murders at Karlov Manor",
            set_type: "expansion",
            released_at: "2024-02-09",
            card_count: 286,
          },
        ],
      }),
    );
    const ok = await GET(new Request(query));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ sets: [{ code: "mkm" }] });

    const again = await GET(new Request(query));
    expect(again.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).cache).toBe("no-store");
  });

  it("validates autocomplete the same way and does not forward upstream details", async () => {
    requestHeaders = new Headers({ "x-real-ip": "203.0.113.99" });
    const long = await GET(
      new Request(`http://localhost/api/scryfall/search?scope=autocomplete&q=${"a".repeat(201)}`),
    );
    expect(long.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(Response.json({ data: ["Lightning Bolt", 12, ""] }));
    const ok = await GET(
      new Request("http://localhost/api/scryfall/search?scope=autocomplete&q=light&page=2"),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ names: ["Lightning Bolt"] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/cards/autocomplete");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe("error");

    fetchMock.mockResolvedValueOnce(
      Response.json({ details: "Expected 'or' but found 'evil.example'" }, { status: 400 }),
    );
    const failed = await GET(new Request("http://localhost/api/scryfall/search?scope=autocomplete&q=light"));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "Scryfall search failed" });
  });

  it("passes a timeout signal to Scryfall and reports a timeout as 502", async () => {
    await search();
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    fetchMock.mockImplementationOnce(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const res = await search();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not reach Scryfall" });
  });
});
