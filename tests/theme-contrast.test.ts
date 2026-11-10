import { describe, expect, it } from "vitest";
import {
  SPELLBRANCH,
  checkContrast,
  readRootTokens,
} from "../scripts/theme-contrast.mjs";

// Spellbranch theme: every color token is one of the brand colors (or the
// single error red), and every text/surface pair meets WCAG AA
// (scripts/theme-contrast.mjs prints the table).
describe("Spellbranch theme", () => {
  const tokens = readRootTokens() as Record<string, string>;

  it("only uses Spellbranch colors for its color tokens", () => {
    const colors = Object.entries(tokens).filter(([name]) => name !== "radius");
    expect(colors.length).toBeGreaterThan(30);
    for (const [name, value] of colors) {
      expect(SPELLBRANCH, `--${name}: ${value}`).toContain(value.toLowerCase());
    }
  });

  it.each(checkContrast(tokens).map((r) => [r.label, r] as const))(
    "%s meets its contrast minimum",
    (_label, row) => {
      expect(row.ratio).toBeGreaterThanOrEqual(row.min);
    },
  );
});
