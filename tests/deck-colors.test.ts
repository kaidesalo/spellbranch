import { describe, expect, it } from "vitest";
import {
  COLOR_COMBOS,
  colorsFromKey,
  comboFor,
  describeColors,
  fitsDeckColors,
  normalizeDeckColors,
  offColorCardNames,
  offColorReason,
  storedCardIdentity,
} from "@/lib/deck-colors";

// The named color combinations and the "fits inside" rule.

const expected: Record<string, string> = {
  White: "W", Blue: "U", Black: "B", Red: "R", Green: "G",
  Azorius: "WU", Dimir: "UB", Rakdos: "BR", Gruul: "RG", Selesnya: "WG",
  Orzhov: "WB", Izzet: "UR", Golgari: "BG", Boros: "WR", Simic: "UG",
  Bant: "WUG", Esper: "WUB", Grixis: "UBR", Jund: "BRG", Naya: "WRG",
  Abzan: "WBG", Jeskai: "WUR", Sultai: "UBG", Mardu: "WBR", Temur: "URG",
  Glint: "UBRG", Dune: "WBRG", Ink: "WURG", Witch: "WUBG", Yore: "WUBR",
  "Five Color": "WUBRG", Colorless: "",
};

describe("COLOR_COMBOS", () => {
  it("maps every named combination to the right colors (WUBRG order)", () => {
    for (const combo of COLOR_COMBOS) {
      expect(combo.colors.join(""), combo.name).toBe(expected[combo.name]);
    }
    expect(COLOR_COMBOS.map((c) => c.name).sort()).toEqual(Object.keys(expected).sort());
  });

  it("covers each of the 32 subsets of WUBRG exactly once", () => {
    const keys = new Set(COLOR_COMBOS.map((c) => c.key));
    expect(COLOR_COMBOS).toHaveLength(32);
    expect(keys.size).toBe(32);
    for (let mask = 0; mask < 32; mask++) {
      const colors = ["W", "U", "B", "R", "G"].filter((_, i) => mask & (1 << i));
      expect(comboFor(colors).colors).toEqual(colors);
    }
  });

  it("groups: 5 mono, 10 guilds, 10 shards and wedges, 5 four-color, then Five Color and Colorless", () => {
    const count = (g: string) => COLOR_COMBOS.filter((c) => c.group === g).length;
    expect([count("Mono"), count("Guilds"), count("Shards and wedges"), count("Four colors"), count("Other")])
      .toEqual([5, 10, 10, 5, 2]);
    for (const c of COLOR_COMBOS) {
      const n = c.colors.length;
      const group = c.key === "C" || n === 5 ? "Other" : ["", "Mono", "Guilds", "Shards and wedges", "Four colors"][n];
      expect(c.group, c.name).toBe(group);
    }
  });

  it("picker values round-trip; anything else is refused", () => {
    for (const c of COLOR_COMBOS) expect(colorsFromKey(c.key)).toEqual(c.colors);
    expect(colorsFromKey("C")).toEqual([]);
    for (const bad of ["", "BU", "UBX", "wubrg", "c", 42, null, undefined, "W,U"]) {
      expect(colorsFromKey(bad), String(bad)).toBeNull();
    }
  });

  it("describes colors by name", () => {
    expect(describeColors(["B", "U"])).toBe("Dimir (Blue, Black)");
    expect(describeColors(["G"])).toBe("Green");
    expect(describeColors([])).toBe("Colorless");
  });
});

describe("fitting inside the deck colors", () => {
  it("identity must be a subset; colorless always fits; null deck colors fit everything", () => {
    expect(fitsDeckColors(["U"], ["U", "B"])).toBe(true);
    expect(fitsDeckColors(["U", "B"], ["U", "B"])).toBe(true);
    expect(fitsDeckColors(["R"], ["U", "B"])).toBe(false);
    expect(fitsDeckColors(["B", "R"], ["U", "B"])).toBe(false);
    expect(fitsDeckColors([], ["U", "B"])).toBe(true);
    expect(fitsDeckColors([], [])).toBe(true);
    expect(fitsDeckColors(["W"], [])).toBe(false);
    expect(fitsDeckColors(["W", "U", "B", "R", "G"], null)).toBe(true);
  });

  it("explains why a card doesn't fit", () => {
    expect(offColorReason(["R"], ["U", "B"])).toBe("Red is outside this deck's colors (Dimir).");
    expect(offColorReason(["W", "R", "G"], ["U", "B"])).toBe("White, Red and Green are outside this deck's colors (Dimir).");
    expect(offColorReason(["U"], [])).toBe("Blue is outside this deck's colors (Colorless).");
    expect(offColorReason(["U"], ["U", "B"])).toBeNull();
    expect(offColorReason(["R"], null)).toBeNull();
  });

  it("stored cards use their identity, or their colors when none was stored", () => {
    expect(storedCardIdentity({ colorIdentity: ["B", "R"], colors: ["B"] })).toEqual(["B", "R"]);
    expect(storedCardIdentity({ colorIdentity: null, colors: ["G", "W"] })).toEqual(["W", "G"]);
    expect(storedCardIdentity({ colors: [] })).toEqual([]);
    expect(storedCardIdentity({ colorIdentity: [], colors: ["R"] })).toEqual([]);
  });

  it("lists the cards that don't fit, sorted, once each", () => {
    const cards = [
      { cardName: "Fireball", colors: ["R"], colorIdentity: ["R"] },
      { cardName: "Counterspell", colors: ["U"], colorIdentity: ["U"] },
      { cardName: "Kitchen Finks", colors: ["W", "G"], colorIdentity: ["W", "G"] },
      { cardName: "Fireball", colors: ["R"], colorIdentity: ["R"] },
      { cardName: "Sol Ring", colors: [], colorIdentity: [] },
    ];
    expect(offColorCardNames(cards, ["U", "B"])).toEqual(["Fireball", "Kitchen Finks"]);
    expect(offColorCardNames(cards, null)).toEqual([]);
  });

  it("normalizes to W/U/B/R/G once each, flattening nested arrays", () => {
    expect(normalizeDeckColors(["G", "x", "W", "G", ["U"]])).toEqual(["W", "U", "G"]);
    expect(normalizeDeckColors(null)).toEqual([]);
  });
});
