import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE, setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

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
