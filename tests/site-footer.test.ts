import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter, footerRevision } from "@/components/layout/site-footer";
import type { ReleaseEnv } from "@/lib/release-label";

function footerHtml(revision: string | null, env: ReleaseEnv = {}) {
  return renderToStaticMarkup(createElement(SiteFooter, { revision, env }));
}

describe("SiteFooter", () => {
  it("shows the beta notice and links vulpibyte.dev in a new tab", () => {
    const html = footerHtml("abc1234");
    expect(html).toContain("Spellbranch is currently in beta testing.");
    expect(html).toContain("Features may change and data may be reset.");
    expect(html).toContain("· Beta · abc1234");
    expect(html).not.toContain("v1.0");
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
    const html = footerHtml(null);
    expect(html).toContain("· Beta");
    expect(html).not.toContain("abc1234");
    expect(footerRevision({})).toBeNull();
    expect(footerRevision({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" })).toBe("0123456");
  });

  it("shows v1.0 on production with no commit hash and no trailing separator", () => {
    const html = footerHtml("cfd27e3", { VERCEL_ENV: "production" });
    const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    expect(text).toMatch(/© 2026 Spellbranch · Created by vulpibyte\.dev · v1\.0$/);
    expect(text).not.toContain("cfd27e3");
    expect(text).not.toMatch(/v1\.0\s*·/);
    expect(html).not.toContain("beta testing");
    expect(html).not.toContain("Features may change and data may be reset.");
    expect(html).not.toContain("· Beta");
    expect(html).toContain('href="https://vulpibyte.dev"');
    expect(html).toContain('href="https://scryfall.com"');
  });

  it("keeps Beta and the commit hash for preview, development, and an unset environment", () => {
    const envs: ReleaseEnv[] = [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}];
    for (const env of envs) {
      const html = footerHtml("cfd27e3", env);
      const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      expect(html).toContain("Spellbranch is currently in beta testing.");
      expect(text).toMatch(/© 2026 Spellbranch · Created by vulpibyte\.dev · Beta · cfd27e3$/);
      expect(html).not.toContain("v1.0");
    }
  });
});
