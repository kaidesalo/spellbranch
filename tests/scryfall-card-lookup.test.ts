import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getScryfallCard,
  SCRYFALL_CARD_MAX_BYTES,
  SCRYFALL_CARD_TIMEOUT_MS,
  ScryfallLookupError,
} from "@/lib/scryfall/client";

// Cipher PR #9 L1: the server-side card lookup has a timeout and a body-size
// cap, and reports each failure as a typed error. Fake data, stubbed fetch.

const ID = "11111111-2222-4333-8444-555555555555";
const CARD = { id: ID, name: "Test Legend", type_line: "Legendary Creature — Elf" };

type FetchInit = RequestInit & { signal?: AbortSignal };
const stubFetch = (impl: (url: string, init: FetchInit) => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
};

/** A body that sends `chunks` chunks of `size` bytes, counting how many were pulled. */
function streamedBody(chunks: number, size: number) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, stats: () => ({ pulled, cancelled }) };
}

async function rejectsKind(p: Promise<unknown>, kind: ScryfallLookupError["kind"]) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ScryfallLookupError);
  expect((err as ScryfallLookupError).kind).toBe(kind);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getScryfallCard", () => {
  it("uses a 5 s timeout and a ~1 MB cap by default", () => {
    expect(SCRYFALL_CARD_TIMEOUT_MS).toBe(5000);
    expect(SCRYFALL_CARD_MAX_BYTES).toBe(1_000_000);
  });

  it("returns the card, passing an abort signal to fetch", async () => {
    const fetch = stubFetch(async () => Response.json(CARD));
    expect(await getScryfallCard(ID)).toEqual(CARD);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://api.scryfall.com/cards/${ID}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null on 404 and throws 'unavailable' on other errors", async () => {
    stubFetch(async () => new Response("{}", { status: 404 }));
    expect(await getScryfallCard(ID)).toBeNull();
    stubFetch(async () => new Response("{}", { status: 503 }));
    await rejectsKind(getScryfallCard(ID), "unavailable");
    stubFetch(async () => { throw new TypeError("fetch failed"); });
    await rejectsKind(getScryfallCard(ID), "unavailable");
    stubFetch(async () => new Response("not json"));
    await rejectsKind(getScryfallCard(ID), "unavailable");
  });

  it("times out a request that never answers", async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const started = Date.now();
    await rejectsKind(getScryfallCard(ID, { timeoutMs: 50 }), "timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("times out a body that stalls after the headers", async () => {
    stubFetch(async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":'));
          init.signal!.addEventListener("abort", () => controller.error(init.signal!.reason));
        },
      });
      return new Response(stream);
    });
    await rejectsKind(getScryfallCard(ID, { timeoutMs: 50 }), "timeout");
  });

  it("refuses an oversize body by its Content-Length without reading it", async () => {
    const body = streamedBody(10, 1000);
    stubFetch(async () => new Response(body.stream, { headers: { "content-length": "2000000" } }));
    await rejectsKind(getScryfallCard(ID), "too-large");
    expect(body.stats().pulled).toBeLessThanOrEqual(1);
  });

  it("stops reading a body that grows past the cap without a Content-Length", async () => {
    const body = streamedBody(100, 64 * 1024); // 6.5 MB if read to the end
    stubFetch(async () => new Response(body.stream));
    await rejectsKind(getScryfallCard(ID), "too-large");
    expect(body.stats().pulled).toBeLessThan(20);
    expect(body.stats().cancelled).toBe(true);
  });

  it("reads a body right at the cap", async () => {
    const json = JSON.stringify(CARD);
    const padded = json + " ".repeat(200 - new TextEncoder().encode(json).byteLength); // 200 bytes
    stubFetch(async () => new Response(padded));
    expect(await getScryfallCard(ID, { maxBytes: 200 })).toEqual(CARD);
    stubFetch(async () => new Response(padded + " "));
    await rejectsKind(getScryfallCard(ID, { maxBytes: 200 }), "too-large");
  });
});
