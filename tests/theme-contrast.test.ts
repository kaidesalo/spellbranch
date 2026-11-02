import { describe, expect, it } from "vitest";
import {
  LOST_CENTURY,
  checkContrast,
  readRootTokens,
} from "../scripts/theme-contrast.mjs";

// Lost Century theme: every color token is one of the palette's 16 colors, and
// every text/surface pair meets WCAG AA (scripts/theme-contrast.mjs prints the table).
describe("Lost Century theme", () => {
  const tokens = readRootTokens() as Record<string, string>;

  it("only uses Lost Century colors for its color tokens", () => {
    const colors = Object.entries(tokens).filter(([name]) => name !== "radius");
    expect(colors.length).toBeGreaterThan(30);
    for (const [name, value] of colors) {
      expect(LOST_CENTURY, `--${name}: ${value}`).toContain(value.toLowerCase());
    }
  });

  it.each(checkContrast(tokens).map((r) => [r.label, r] as const))(
    "%s meets its contrast minimum",
    (_label, row) => {
      expect(row.ratio).toBeGreaterThanOrEqual(row.min);
    },
  );
});
