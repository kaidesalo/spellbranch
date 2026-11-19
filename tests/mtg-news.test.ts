import { describe, expect, it, vi, afterEach } from "vitest";
import {
  articleUrl,
  getMtgNews,
  imageUrl,
  parseArticleMeta,
  parseNewsListing,
  selectLatest,
  stripHtml,
  truncateExcerpt,
  type MtgNewsItem,
} from "@/lib/news/mtg-news";

const listing = `
<div data-article-hub-card-v="1">
  <div class="css-KLPvC">Announcements</div>
  <h3>Older note</h3>
  <p>First sentence. Second sentence. Third sentence should drop.</p>
  <a href="/en/news/announcements/older-note">Older note</a>
</div>
<div data-article-hub-card-v="1">
  <div class="css-KLPvC">Feature</div>
  <h3>New &amp; <script>alert(1)</script> shiny</h3>
  <p>Hello <b>world</b>. <img src=x onerror="alert(1)">Stay plain.</p>
  <a href="https://magic.wizards.com/en/news/feature/new-shiny?utm=1">New</a>
  <img src="https://images.ctfassets.net/space/id/hash/art.webp">
</div>
<div data-article-hub-card-v="1">
  <h3>Section index</h3>
  <a href="/en/news/feature">Feature</a>
</div>
<div data-article-hub-card-v="1">
  <h3>Off site</h3>
  <a href="https://evil.example/en/news/feature/stolen">nope</a>
</div>
<div data-article-hub-card-v="1">
  <h3>Javascript</h3>
  <a href="javascript:alert(1)">nope</a>
</div>
<div data-article-hub-card-v="1">
  <div class="css-KLPvC">Story</div>
  <h3>Middle</h3>
  <a href="https://magic.wizards.com.evil.com/en/news/story/middle">nope</a>
</div>
<div data-article-hub-card-v="1">
  <div class="css-KLPvC">Story</div>
  <h3>Lookalike host</h3>
  <a href="https://notmagic.wizards.com/en/news/story/lookalike">nope</a>
</div>
`;

function item(over: Partial<MtgNewsItem> & Pick<MtgNewsItem, "title" | "url">): MtgNewsItem {
  return { date: null, excerpt: null, category: null, image: null, ...over };
}

describe("mtg news parser", () => {
  it("keeps official articles, strips HTML, and drops bad links", () => {
    const items = parseNewsListing(listing);
    expect(items.map((entry) => entry.title)).toEqual(["Older note", "New & shiny"]);
    expect(items[1]?.url).toBe("https://magic.wizards.com/en/news/feature/new-shiny");
    expect(items[1]?.excerpt).toBe("Hello world. Stay plain.");
    expect(items[1]?.excerpt).not.toMatch(/<|>|script|onerror/i);
    expect(items[1]?.image).toBe("https://images.ctfassets.net/space/id/hash/art.webp");
    expect(items[0]?.excerpt).toBe("First sentence. Second sentence.");
    expect(items[0]?.category).toBe("Announcements");
  });

  it("rejects the wrong host, http, and logo images", () => {
    expect(articleUrl("http://magic.wizards.com/en/news/feature/new-shiny")).toBeNull();
    expect(articleUrl("https://user:pass@magic.wizards.com/en/news/feature/new-shiny")).toBeNull();
    expect(articleUrl("/en/news/feature")).toBeNull();
    expect(imageUrl("https://images.ctfassets.net/space/logo.png")).toBeNull();
    expect(imageUrl("https://cdn.ctfassets.net/space/art.webp")).toBeNull();
    expect(imageUrl("http://images.ctfassets.net/space/art.webp")).toBeNull();
  });

  it("reads a date and thumbnail from an article page", () => {
    const meta = parseArticleMeta(`
      <meta property="og:image" content="https://images.ctfassets.net/s/a/b/hero.webp">
      <meta name="description" content="One line. Two lines. Three lines.">
      <time>Nov 18, 2026</time>
    `);
    expect(meta.date).toBe("2026-11-18");
    expect(meta.image).toBe("https://images.ctfassets.net/s/a/b/hero.webp");
    expect(meta.excerpt).toBe("One line. Two lines.");
  });

  it("sorts newest first and keeps six", () => {
    const items = [
      item({ title: "old", url: "https://magic.wizards.com/en/news/feature/old", date: "2026-01-01" }),
      item({ title: "new", url: "https://magic.wizards.com/en/news/feature/new", date: "2026-11-18" }),
      item({ title: "mid", url: "https://magic.wizards.com/en/news/feature/mid", date: "2026-06-01" }),
      item({ title: "undated", url: "https://magic.wizards.com/en/news/feature/undated" }),
      ...Array.from({ length: 5 }, (_, index) =>
        item({
          title: `extra ${index}`,
          url: `https://magic.wizards.com/en/news/feature/extra-${index}`,
          date: `2026-02-0${index + 1}`,
        }),
      ),
    ];
    const selected = selectLatest(items);
    expect(selected).toHaveLength(6);
    expect(selected.map((entry) => entry.title)).toEqual([
      "new",
      "mid",
      "extra 4",
      "extra 3",
      "extra 2",
      "extra 1",
    ]);
    expect(selected.some((entry) => entry.title === "undated")).toBe(false);
  });

  it("truncates a long excerpt without markup", () => {
    const text = stripHtml("<p>Word</p> ".repeat(80));
    const excerpt = truncateExcerpt(text, 80);
    expect(excerpt).toBeTruthy();
    expect(excerpt!.length).toBeLessThanOrEqual(80);
    expect(excerpt).not.toContain("<");
    expect(excerpt!.endsWith("…")).toBe(true);
  });
});

describe("getMtgNews", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns an empty list when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(getMtgNews()).resolves.toEqual([]);
  });

  it("returns an empty list when news is switched off", async () => {
    vi.stubEnv("SPELLBRANCH_MTG_NEWS", "off");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getMtgNews()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
