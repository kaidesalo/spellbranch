import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintingGrid, PrintingSkeleton, PRINTING_GRID_CLASS } from "@/components/cards/printing-picker";
import type { CardPrinting } from "@/lib/scryfall/client";

const NORMAL = "https://cards.scryfall.io/normal/front/a/b/bolt.jpg";

function printing(overrides: Partial<CardPrinting> & Pick<CardPrinting, "id" | "setName">): CardPrinting {
  return {
    setCode: "LEA",
    collectorNumber: "161",
    releasedAt: "1993-08-05",
    imageUri: NORMAL,
    finishes: ["nonfoil"],
    name: "Lightning Bolt",
    ...overrides,
  };
}

const alpha = printing({ id: "alpha", setName: "Limited Edition Alpha", setCode: "LEA", collectorNumber: "161" });
const secret = printing({
  id: "sld",
  setName: "Secret Lair Drop",
  setCode: "SLD",
  collectorNumber: "268",
  releasedAt: "2026-06-15",
  finishes: ["nonfoil", "foil"],
});

function grid(props: Partial<Parameters<typeof PrintingGrid>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PrintingGrid, {
      printings: [alpha, secret],
      currentId: "alpha",
      busy: false,
      chooseFinish: false,
      pickedId: null,
      onTile: () => undefined,
      onFinish: () => undefined,
      ...props,
    }),
  );
}

describe("printing picker tiles", () => {
  it("renders a card image, the set details, and one Use action", () => {
    const html = grid();
    expect(html).toContain(PRINTING_GRID_CLASS);
    expect(html).toContain("auto-fill");
    expect(html).toContain("aspect-[63/88]");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(`alt="Limited Edition Alpha #161"`);
    expect(html).toContain(NORMAL);
    expect(html).toContain("Secret Lair Drop (SLD)");
    expect(html).toContain("#268");
    expect(html).toContain("2026-06-15");
    expect(html).toContain("Nonfoil, Foil");
    expect(html).toContain('aria-label="Use Secret Lair Drop (SLD) #268"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(">Current<");
    expect(html).not.toContain(">Choose<");
    const alphaAt = html.indexOf('aria-label="Current printing, Limited Edition Alpha (LEA) #161"');
    const secretAt = html.indexOf('aria-label="Use Secret Lair Drop (SLD) #268"');
    expect(alphaAt).toBeGreaterThanOrEqual(0);
    expect(alphaAt).toBeLessThan(secretAt);
  });

  it("shows finish choices only for the printing the owner opened", () => {
    const html = grid({ chooseFinish: true, pickedId: "sld" });
    expect(html).toContain('aria-label="Choose a finish for Secret Lair Drop (SLD) #268"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-testid="printing-finish"');
    expect(html).toContain(">Nonfoil<");
    expect(html).toContain(">Foil<");
    const closed = grid({ chooseFinish: true, pickedId: null });
    expect(closed).not.toContain('data-testid="printing-finish"');
  });

  it("shows a skeleton grid while printings load", () => {
    const html = renderToStaticMarkup(createElement(PrintingSkeleton));
    expect(html).toContain('data-testid="printing-skeleton"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading printings");
    expect(html.match(/aspect-\[63\/88\]/g)?.length).toBe(6);
  });
});
