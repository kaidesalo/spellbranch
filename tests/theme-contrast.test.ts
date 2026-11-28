import { describe, expect, it } from "vitest";
import {
  LIGHT_PALETTE,
  SPELLBRANCH,
  checkContrast,
  readDarkTokens,
  readRootTokens,
} from "../scripts/theme-contrast.mjs";

// Spellbranch theme: dark tokens stay on the original brand colors, light
// tokens stay on the parchment palette, and every text/surface pair meets
// WCAG AA (scripts/theme-contrast.mjs prints both tables).
describe("Spellbranch theme", () => {
  const light = readRootTokens() as Record<string, string>;
  const dark = readDarkTokens() as Record<string, string>;

  it("uses the parchment palette for light color tokens", () => {
    const colors = Object.entries(light).filter(([name]) => name !== "radius");
    expect(colors.length).toBeGreaterThan(30);
    for (const [name, value] of colors) {
      expect(LIGHT_PALETTE, `--${name}: ${value}`).toContain(value.toLowerCase());
    }
  });

  it("keeps the original Spellbranch colors for dark color tokens", () => {
    const colors = Object.entries(dark).filter(([name]) => name !== "radius");
    expect(colors.length).toBeGreaterThan(30);
    for (const [name, value] of colors) {
      expect(SPELLBRANCH, `--${name}: ${value}`).toContain(value.toLowerCase());
    }
  });

  it.each(checkContrast(light).map((r) => [r.label, r] as const))(
    "light: %s meets its contrast minimum",
    (_label, row) => {
      expect(row.ratio).toBeGreaterThanOrEqual(row.min);
    },
  );

  it.each(checkContrast(dark).map((r) => [r.label, r] as const))(
    "dark: %s meets its contrast minimum",
    (_label, row) => {
      expect(row.ratio).toBeGreaterThanOrEqual(row.min);
    },
  );
});
