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
    const disclaimer =
      "Spellbranch is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.";
    const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    expect(text).toContain(disclaimer);
    expect(html).not.toContain("trademarks of Wizards of the Coast");
    expect(html).toContain('href="https://company.wizards.com/en/legal/fancontentpolicy"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">Fan Content Policy</a>");
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
