import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_STORAGE_KEY, parseThemeChoice, resolveTheme } from "@/lib/theme";

describe("color mode choice", () => {
  it("defaults a missing or unknown value to system", () => {
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice(undefined)).toBe("system");
    expect(parseThemeChoice("")).toBe("system");
    expect(parseThemeChoice("sepia")).toBe("system");
  });

  it("keeps an explicit light or dark choice", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("system")).toBe("system");
  });

  it("follows the OS only while the choice is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("theme script in the provider", () => {
  it("prints the blocking script before the page, with the storage key and the nonce", () => {
    const html = renderToString(
      createElement(ThemeProvider, { nonce: "nonce-theme" }, createElement("main", { id: "page" }, "Spellbranch")),
    );
    const scriptAt = html.indexOf(THEME_STORAGE_KEY);
    expect(scriptAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(html.indexOf('id="page"'));
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('nonce="nonce-theme"');
    expect(html).toContain("classList");
  });
});
