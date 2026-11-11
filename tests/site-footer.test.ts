import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter, footerRevision } from "@/components/layout/site-footer";

describe("SiteFooter", () => {
  it("shows the beta notice and links vulpibyte.dev in a new tab", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, { revision: "abc1234" }));
    expect(html).toContain("Spellbranch is currently in beta testing.");
    expect(html).toContain("Features may change and data may be reset.");
    expect(html).toContain('href="https://vulpibyte.dev"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("vulpibyte.dev");
    expect(html).toContain("abc1234");
    expect(html).toContain("unofficial Fan Content permitted under the");
    expect(html).toContain('href="https://scryfall.com"');
    expect(html).not.toMatch(/Terms|Privacy Policy|instagram|twitter/i);
  });

  it("omits the commit id when the build does not provide one", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, { revision: null }));
    expect(html).toContain("· Beta");
    expect(html).not.toContain("abc1234");
    expect(footerRevision({})).toBeNull();
    expect(footerRevision({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" })).toBe("0123456");
  });
});
