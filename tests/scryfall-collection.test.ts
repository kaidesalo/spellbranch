import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SCRYFALL_COLLECTION_LIMIT,
  SCRYFALL_COLLECTION_TIMEOUT_MS,
  SCRYFALL_NAME_LOOKUP_MAX,
  ScryfallLookupError,
  getScryfallCardsByName,
} from "@/lib/scryfall/client";

// Name lookup for deck import: Scryfall's collection endpoint only, with a
// timeout, a body cap, and no redirects or cookies.

type FetchInit = RequestInit & { signal?: AbortSignal };
const stubFetch = (impl: (url: string, init: FetchInit) => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function names(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Card ${i}`);
}

describe("getScryfallCardsByName", () => {
  it("posts only to Scryfall's collection endpoint and does not follow redirects", async () => {
    const fetch = stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { identifiers: { name: string }[] };
      return Response.json({
        data: body.identifiers.map((id) => ({ id: "11111111-2222-4333-8444-555555555555", name: id.name, type_line: "Instant" })),
      });
    });
    const found = await getScryfallCardsByName(["Sol Ring", "sol ring", "Forest"], { gapMs: 0 });
    expect(found.map((card) => card.name)).toEqual(["Sol Ring", "Forest"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.scryfall.com/cards/collection");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init.headers).get("cookie")).toBeNull();
    const sent = JSON.parse(String(init.body)) as { identifiers: { name: string }[] };
    expect(sent.identifiers).toEqual([{ name: "Sol Ring" }, { name: "Forest" }]);
    expect(SCRYFALL_COLLECTION_TIMEOUT_MS).toBe(8000);
    expect(SCRYFALL_COLLECTION_LIMIT).toBe(75);
  });

  it("splits a long list into batches of 75 and stops at the cap", async () => {
    const fetch = stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { identifiers: { name: string }[] };
      return Response.json({ data: body.identifiers.map((id) => ({ name: id.name, type_line: "Instant", id: "1" })) });
    });
    await getScryfallCardsByName(names(76), { gapMs: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetch.mock.calls[0]![1].body)) as { identifiers: unknown[] };
    const second = JSON.parse(String(fetch.mock.calls[1]![1].body)) as { identifiers: unknown[] };
    expect(first.identifiers).toHaveLength(75);
    expect(second.identifiers).toHaveLength(1);

    vi.unstubAllGlobals();
    const blocked = stubFetch(async () => Response.json({ data: [] }));
    await expect(getScryfallCardsByName(names(SCRYFALL_NAME_LOOKUP_MAX + 1), { gapMs: 0 })).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(blocked).not.toHaveBeenCalled();
  });

  it("does not fetch when there are no names", async () => {
    const fetch = stubFetch(async () => Response.json({ data: [] }));
    expect(await getScryfallCardsByName([])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws when Scryfall errors, times out, or sends too much", async () => {
    stubFetch(async () => new Response("{}", { status: 503 }));
    await expect(getScryfallCardsByName(["Sol Ring"])).rejects.toMatchObject({ kind: "unavailable" });

    stubFetch(async () => new Response("not json", { status: 200 }));
    await expect(getScryfallCardsByName(["Sol Ring"])).rejects.toBeInstanceOf(ScryfallLookupError);

    stubFetch(async () => new Response("{}", { status: 200, headers: { "content-length": "99999999" } }));
    await expect(getScryfallCardsByName(["Sol Ring"])).rejects.toMatchObject({ kind: "too-large" });

    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(getScryfallCardsByName(["Sol Ring"], { timeoutMs: 20 })).rejects.toMatchObject({
      kind: "timeout",
    });
  });
});
