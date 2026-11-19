import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MtgNewsSection } from "@/components/home/mtg-news-section";
import type { MtgNewsItem } from "@/lib/news/mtg-news";

const article: MtgNewsItem = {
  title: "Secret Lair: My Arrakis",
  url: "https://magic.wizards.com/en/news/announcements/secret-lair-my-arrakis",
  date: "2026-11-18",
  excerpt: "Enter the Dune universe.",
  category: "Announcements",
  image: "https://images.ctfassets.net/space/id/hash/art.webp",
};

describe("MtgNewsSection", () => {
  it("links out with a new tab and shows the headline", () => {
    const html = renderToStaticMarkup(createElement(MtgNewsSection, { articles: [article] }));
    expect(html).toContain("Secret Lair: My Arrakis");
    expect(html).toContain("Enter the Dune universe.");
    expect(html).toContain("Announcements");
    expect(html).toContain("Nov 18, 2026");
    expect(html).toContain(
      'href="https://magic.wizards.com/en/news/announcements/secret-lair-my-arrakis" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).not.toContain("dangerouslySetInnerHTML");
    expect(html).not.toContain("<script");
  });

  it("says news is unavailable when there are no articles", () => {
    const html = renderToStaticMarkup(createElement(MtgNewsSection, { articles: [] }));
    expect(html).toContain("News unavailable right now.");
    expect(html).not.toContain("magic.wizards.com/en/news/announcements/");
    expect(html).toContain("Latest Magic news");
  });
});
