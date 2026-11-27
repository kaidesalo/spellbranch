/**
 * Color mode. Light, Dark, or System (the default). System follows
 * prefers-color-scheme and updates when the OS setting changes.
 *
 * The blocking script that applies this before paint lives in next-themes
 * (ThemeProvider in the root layout, attribute="class", this storage key).
 * These helpers are the same rules, so tests can check them without a browser.
 */

export const THEME_STORAGE_KEY = "spellbranch-theme";

export const THEME_CHOICES = ["light", "dark", "system"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export type ResolvedTheme = "light" | "dark";

/** Anything other than light or dark is System, including a missing value. */
export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  if (value === "light" || value === "dark") return value;
  return "system";
}

/**
 * The class written on <html>. An explicit light or dark choice wins.
 * System, and any other stored value, follows the OS.
 */
export function resolveTheme(choice: string | null | undefined, prefersDark: boolean): ResolvedTheme {
  const parsed = parseThemeChoice(choice);
  if (parsed === "light" || parsed === "dark") return parsed;
  return prefersDark ? "dark" : "light";
}
