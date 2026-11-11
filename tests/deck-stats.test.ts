import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeckStatistics } from "@/components/decks/deck-stats";
import {
  applyPrintingFacts,
  computeDeckStats,
  formatAverage,
  formatUsd,
  manaValueOfCost,
  pipsInCost,
  printingFacts,
  sourcesForDeckStats,
  unitPrice,
  type DeckStatSource,
} from "@/lib/deck-stats";

function card(overrides: Partial<DeckStatSource> & Pick<DeckStatSource, "cardName" | "manaCost" | "typeLine">): DeckStatSource {
  return {
    quantity: 1,
    board: "main",
    colorIdentity: [],
    ...overrides,
  };
}

describe("mana costs", () => {
  it("splits hybrid pips, counts Phyrexian and twobrid as their color, and ignores X", () => {
    expect(pipsInCost("{W/U}")).toMatchObject({ W: 0.5, U: 0.5, R: 0 });
    expect(pipsInCost("{W/U}{W/U}")).toMatchObject({ W: 1, U: 1 });
    expect(pipsInCost("{G/P}{G/P}")).toMatchObject({ G: 2 });
    expect(pipsInCost("{W/U/P}")).toMatchObject({ W: 0.5, U: 0.5 });
    expect(pipsInCost("{2/W}")).toMatchObject({ W: 1, C: 0 });
    expect(pipsInCost("{2/C}")).toMatchObject({ C: 1, W: 0 });
    expect(pipsInCost("{C/W}")).toMatchObject({ C: 0.5, W: 0.5 });
    expect(pipsInCost("{X}{R}{R}")).toMatchObject({ R: 2, C: 0 });
    expect(pipsInCost("{C}")).toMatchObject({ C: 1 });
    expect(manaValueOfCost("{X}{R}")).toBe(1);
    expect(manaValueOfCost("{2/W}")).toBe(2);
    expect(manaValueOfCost("{W/U}")).toBe(1);
    expect(manaValueOfCost(null)).toBe(0);
  });
});

describe("deck stats math", () => {
  const bolt = card({
    cardName: "Lightning Bolt",
    manaCost: "{R}",
    typeLine: "Instant",
    quantity: 4,
    cmc: 1,
    usd: 0.5,
    colorIdentity: ["R"],
  });
  const bear = card({
    cardName: "Grizzly Bears",
    manaCost: "{1}{G}",
    typeLine: "Creature — Bear",
    cmc: 2,
    usd: 0.1,
    colorIdentity: ["G"],
    producedMana: ["G"],
  });
  const forest = card({
    cardName: "Forest",
    manaCost: null,
    typeLine: "Basic Land — Forest",
    quantity: 2,
    cmc: 0,
    usd: 0.05,
    colorIdentity: ["G"],
    producedMana: ["G"],
  });
  const side = card({
    cardName: "Emrakul",
    manaCost: "{15}",
    typeLine: "Creature — Eldrazi",
    board: "side",
    cmc: 15,
    usd: 20,
    colorIdentity: [],
  });
  const maybe = card({
    cardName: "Birds of Paradise",
    manaCost: "{G}",
    typeLine: "Creature — Bird",
    board: "maybe",
    cmc: 1,
    usd: 8,
    producedMana: ["W", "U", "B", "R", "G"],
    colorIdentity: ["G"],
  });

  it("buckets the curve, averages nonlands, and leaves side and maybe boards out", () => {
    const counted = sourcesForDeckStats([bolt, bear, forest, side, maybe], null);
    expect(counted.map((row) => row.cardName)).toEqual(["Lightning Bolt", "Grizzly Bears", "Forest"]);
    const stats = computeDeckStats(counted, ["R", "G"]);
    expect(stats.curve.map((bucket) => bucket.count)).toEqual([0, 4, 1, 0, 0, 0, 0, 0]);
    expect(stats.curve[1]).toMatchObject({ creatures: 0, other: 4 });
    expect(stats.curve[2]).toMatchObject({ creatures: 1, other: 0 });
    expect(stats.spellCount).toBe(5);
    expect(stats.averageCmc).toBeCloseTo((1 * 4 + 2) / 5);
    expect(formatAverage(stats.averageCmc)).toBe("1.20");
    expect(stats.types).toEqual([
      { type: "Creature", count: 1 },
      { type: "Instant", count: 4 },
      { type: "Land", count: 2 },
    ]);
    expect(stats.colors.find((row) => row.color === "R")).toMatchObject({ pips: 4 });
    expect(stats.colors.find((row) => row.color === "G")).toMatchObject({ pips: 1, sources: 3 });
    expect(stats.colors.find((row) => row.color === "W")).toBeUndefined();
  });

  it("sends mana value 7 and above into the 7+ bucket", () => {
    const stats = computeDeckStats(
      [
        card({ cardName: "Big", manaCost: "{8}", typeLine: "Sorcery", cmc: 8 }),
        card({ cardName: "Seven", manaCost: "{7}", typeLine: "Sorcery", cmc: 7 }),
        card({ cardName: "Twelve", manaCost: "{12}", typeLine: "Sorcery", cmc: 12, quantity: 2 }),
      ],
      [],
    );
    expect(stats.curve[7]).toMatchObject({ label: "7+", count: 4, other: 4 });
  });

  it("includes the commander once, even when the same card is already on the mainboard", () => {
    const commander = card({
      cardName: "Ghoulcaller Gisa",
      scryfallId: "gisa",
      manaCost: "{3}{B}{B}{B}",
      typeLine: "Legendary Creature — Human Wizard",
      cmc: 6,
      usd: 1,
      colorIdentity: ["B"],
    });
    const withSlot = computeDeckStats(sourcesForDeckStats([bolt], commander), ["R", "B"]);
    expect(withSlot.spellCount).toBe(5);
    expect(withSlot.curve[6]!.count).toBe(1);
    const duplicated = computeDeckStats(
      sourcesForDeckStats([{ ...commander, board: "main" }, bolt], commander),
      ["R", "B"],
    );
    expect(duplicated.curve[6]!.count).toBe(1);
    expect(duplicated.spellCount).toBe(5);
  });

  it("counts a source once per color inside the deck identity, including colorless", () => {
    const tower = card({
      cardName: "Command Tower",
      manaCost: null,
      typeLine: "Land",
      colorIdentity: [],
      producedMana: ["W", "U", "B", "R", "G", "G"],
    });
    const wastes = card({
      cardName: "Wastes",
      manaCost: null,
      typeLine: "Basic Land — Wastes",
      quantity: 2,
      producedMana: ["C"],
      colorIdentity: [],
    });
    const green = computeDeckStats([tower, wastes], ["G"]);
    expect(green.colors.find((row) => row.color === "G")).toMatchObject({ sources: 1 });
    expect(green.colors.find((row) => row.color === "R")).toBeUndefined();
    expect(green.colors.find((row) => row.color === "C")).toMatchObject({ sources: 2 });
    const open = computeDeckStats([tower], null);
    expect(open.totalSources).toBe(0);
  });

  it("prices foil printings with usd foil and falls back when that price is missing", () => {
    expect(unitPrice({ foil: true, usd: 1, usdFoil: 4 })).toBe(4);
    expect(unitPrice({ foil: true, usd: 1, usdFoil: null })).toBe(1);
    expect(unitPrice({ foil: false, usd: 1, usdFoil: 4 })).toBe(1);
    const stats = computeDeckStats(
      [
        card({
          cardName: "Bolt",
          manaCost: "{R}",
          typeLine: "Instant",
          quantity: 3,
          foil: true,
          usd: 0.25,
          usdFoil: 2,
        }),
        card({ cardName: "Unpriced", manaCost: "{R}", typeLine: "Instant", usd: null, usdFoil: 9 }),
      ],
      ["R"],
    );
    expect(stats.priceUsd).toBe(6);
    expect(stats.unpriced).toBe(1);
    expect(formatUsd(stats.priceUsd)).toBe("$6");
    expect(formatUsd(140)).toBe("$140");
    expect(formatUsd(3.5)).toBe("$3.50");
    expect(formatUsd(null)).toBe("—");
  });

  it("uses the normal image fields Scryfall returns for a printing", () => {
    const facts = printingFacts({
      id: "ABC",
      cmc: 1,
      mana_cost: "",
      prices: { usd: "0.40", usd_foil: "1.25" },
      card_faces: [{ mana_cost: "{R}", produced_mana: ["R"] }, { mana_cost: "{1}{R}", produced_mana: ["R"] }],
    });
    expect(facts).toMatchObject({
      id: "abc",
      cmc: 1,
      manaCost: "{R}{1}{R}",
      producedMana: ["R"],
      usd: 0.4,
      usdFoil: 1.25,
    });
    const applied = applyPrintingFacts(
      card({ cardName: "Bolt", manaCost: null, typeLine: "Instant" }),
      facts,
    );
    expect(applied.cmc).toBe(1);
    expect(applied.usdFoil).toBe(1.25);
  });
});

describe("deck stats section", () => {
  it("renders the summary, the curve counts, and the counting rules", () => {
    const stats = computeDeckStats(
      [
        card({ cardName: "Bolt", manaCost: "{R}", typeLine: "Instant", quantity: 2, cmc: 1, usd: 1 }),
      ],
      ["R"],
    );
    const html = renderToStaticMarkup(
      createElement(DeckStatistics, {
        stats,
        formatLabel: "Modern",
        colors: ["R"],
        countLabel: "2 cards",
        scryfallUnavailable: false,
        includesCommander: false,
      }),
    );
    expect(html).toContain("Avg CMC");
    expect(html).toContain("1.00");
    expect(html).toContain("est.");
    expect(html).toContain("$2");
    expect(html).toContain("Hybrid pips are split evenly");
    expect(html).toContain("Sideboard");
    expect(html).toContain('data-count="2"');
    expect(html).toContain("role=\"img\"");
    expect(html).toContain("Average mana value of nonland cards.");
  });
});
