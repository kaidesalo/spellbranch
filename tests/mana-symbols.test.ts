import { readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MANA_SYMBOL_SLUGS,
  manaCostLabel,
  parseSymbols,
  resolveSymbol,
} from "@/lib/mana";
import type { DeckCard, DeckCommander } from "@/lib/types";

vi.mock("@/lib/actions/decks", () => ({
  updateCardQuantityAction: vi.fn(async () => ({ success: true })),
  setCommanderAction: vi.fn(async () => ({ success: true })),
  setPreferredBranchAction: vi.fn(async () => ({ success: true })),
}));

const { ManaCost, ManaText } = await import("@/components/cards/mana-symbols");
const { DeckList } = await import("@/components/decks/deck-list");
const { CommanderSlot } = await import("@/components/decks/commander-slot");
const { CompareView } = await import("@/components/decks/compare-view");

const render = renderToStaticMarkup;
const label = (token: string) => resolveSymbol(token)?.label;
const slug = (token: string) => resolveSymbol(token)?.slug;

describe("mana symbol parser", () => {
  it("generic numbers, including {0} and 10+", () => {
    expect(label("{0}")).toBe("Zero mana");
    expect(label("{1}")).toBe("One generic mana");
    expect(label("{2}")).toBe("Two generic mana");
    expect(label("{10}")).toBe("Ten generic mana");
    expect(label("{16}")).toBe("Sixteen generic mana");
    expect(label("{20}")).toBe("Twenty generic mana");
    expect(slug("{15}")).toBe("15");
  });

  it("X, Y and Z", () => {
    expect(label("{X}")).toBe("X generic mana");
    expect(label("{Y}")).toBe("Y generic mana");
    expect(label("{Z}")).toBe("Z generic mana");
  });

  it("colors, colorless and snow", () => {
    expect(["{W}", "{U}", "{B}", "{R}", "{G}", "{C}", "{S}"].map(label)).toEqual([
      "White", "Blue", "Black", "Red", "Green", "Colorless", "Snow",
    ]);
  });

  it("hybrid, colorless hybrid and two-generic hybrid", () => {
    expect(label("{W/U}")).toBe("White or Blue hybrid");
    expect(slug("{W/U}")).toBe("WU");
    expect(label("{B/G}")).toBe("Black or Green hybrid");
    expect(label("{C/W}")).toBe("Colorless or White hybrid");
    expect(label("{2/W}")).toBe("Two generic or White hybrid");
    expect(slug("{2/W}")).toBe("2W");
  });

  it("Phyrexian and hybrid Phyrexian", () => {
    expect(label("{B/P}")).toBe("Phyrexian Black");
    expect(slug("{B/P}")).toBe("BP");
    expect(label("{W/U/P}")).toBe("Phyrexian White or Blue hybrid");
    expect(slug("{W/U/P}")).toBe("WUP");
    expect(label("{H}")).toBe("Phyrexian, any color");
  });

  it("Oracle text symbols", () => {
    expect(label("{T}")).toBe("Tap");
    expect(label("{Q}")).toBe("Untap");
    expect(label("{E}")).toBe("Energy");
  });

  it("unknown or backwards symbols stay literal text", () => {
    expect(resolveSymbol("{?}")).toBeNull();
    expect(resolveSymbol("{U/W}")).toBeNull(); // Scryfall never writes it this way
    expect(resolveSymbol("{21}")).toBeNull();
    expect(parseSymbols("{2}{?}")).toEqual([
      { kind: "symbol", text: "{2}", slug: "2", label: "Two generic mana" },
      { kind: "text", text: "{?}" },
    ]);
  });

  it("splits a cost into symbols in order", () => {
    expect(parseSymbols("{B}{B}{R}{R}").map((p) => p.kind === "symbol" && p.slug)).toEqual([
      "B", "B", "R", "R",
    ]);
  });

  it("keeps the ' // ' separator of split and double-faced costs as text", () => {
    const parts = parseSymbols("{1}{R} // {1}{U}");
    expect(parts.map((p) => (p.kind === "symbol" ? p.slug : p.text))).toEqual([
      "1", "R", " // ", "1", "U",
    ]);
  });

  it("splits Oracle text into text and symbols and merges neighbouring text", () => {
    expect(parseSymbols("{T}: Add {B}. Costs {?} more.")).toEqual([
      { kind: "symbol", text: "{T}", slug: "T", label: "Tap" },
      { kind: "text", text: ": Add " },
      { kind: "symbol", text: "{B}", slug: "B", label: "Black" },
      { kind: "text", text: ". Costs {?} more." },
    ]);
  });

  it("empty or null input has no parts", () => {
    expect(parseSymbols("")).toEqual([]);
    expect(parseSymbols(null)).toEqual([]);
    expect(parseSymbols(undefined)).toEqual([]);
    expect(manaCostLabel(null)).toBe("");
  });

  it("reads a whole cost in words", () => {
    expect(manaCostLabel("{2}{B}{B}")).toBe("Two generic mana, Black, Black");
    expect(manaCostLabel("{1}{R} // {1}{U}")).toBe(
      "One generic mana, Red; or One generic mana, Blue",
    );
    expect(manaCostLabel("{X}{?}")).toBe("X generic mana, {?}");
  });

  it("every slug has an icon in /public/mana and every icon is used", () => {
    const files = readdirSync(path.join(__dirname, "..", "public", "mana"))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.replace(/\.svg$/, ""))
      .sort();
    expect([...MANA_SYMBOL_SLUGS].sort()).toEqual(files);
  });
});

describe("ManaCost and ManaText", () => {
  it("labels the whole cost once and hides the icons from screen readers", () => {
    const html = render(createElement(ManaCost, { cost: "{B}{B}{R}{R}" }));
    expect(html).toMatch(/^<span role="img" aria-label="Mana cost: Black, Black, Red, Red"/);
    expect(html.match(/<img /g)).toHaveLength(4);
    expect(html).toContain('src="/mana/B.svg"');
    expect(html).toContain('src="/mana/R.svg"');
    expect(html.match(/alt=""/g)).toHaveLength(4);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(4);
  });

  it("hybrid, Phyrexian, X and the separator", () => {
    const html = render(createElement(ManaCost, { cost: "{X}{W/U}{B/P}{2/G} // {3}" }));
    for (const s of ["X", "WU", "BP", "2G", "3"]) expect(html).toContain(`src="/mana/${s}.svg"`);
    expect(html).toContain("> // </span>");
    expect(html).toContain(
      'aria-label="Mana cost: X generic mana, White or Blue hybrid, Phyrexian Black, Two generic or Green hybrid; or Three generic mana"',
    );
  });

  it("unknown symbols render as their literal text", () => {
    const html = render(createElement(ManaCost, { cost: "{1}{?}" }));
    expect(html).toContain(">{?}</span>");
    expect(html).toContain('aria-label="Mana cost: One generic mana, {?}"');
  });

  it("no cost shows the fallback", () => {
    expect(render(createElement(ManaCost, { cost: null, fallback: "—" }))).toBe("—");
    expect(render(createElement(ManaCost, { cost: "" }))).toBe("");
  });

  it("Oracle text icons carry their own alt text and text is escaped", () => {
    const html = render(createElement(ManaText, { text: "{T}: Add {B}. <b>x</b>" }));
    expect(html).toContain('alt="Tap"');
    expect(html).toContain('alt="Black"');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

const card = {
  id: "c0000000-0000-4000-8000-000000000001",
  deckId: "d0000000-0000-4000-8000-000000000001",
  scryfallId: "s-1",
  cardName: "Kitchen Finks",
  imageUri: "https://cards.scryfall.io/normal/front/a/b/ab.jpg",
  manaCost: "{1}{G/W}{G/W}",
  typeLine: "Creature — Ouphe",
  colors: [],
  oracleText: null,
  quantity: 1,
  createdAt: "2026-11-01T12:00:00.000Z",
} as DeckCard;

describe("where costs render as icons", () => {
  it("deck rows: icons inside the zoom button, controls untouched", () => {
    const html = render(createElement(DeckList, { deckId: card.deckId, cards: [card], canEdit: true }));
    const start = html.indexOf('aria-label="Kitchen Finks, view larger image"');
    const trigger = html.slice(start, html.indexOf("</button>", start));
    expect(trigger).toContain('aria-label="Mana cost: One generic mana, Green or White hybrid, Green or White hybrid"');
    expect(trigger).toContain('src="/mana/GW.svg"');
    expect(html).not.toContain("{G/W}");
    for (const c of ["Decrease Kitchen Finks", "Increase Kitchen Finks", "Remove Kitchen Finks"]) {
      expect(html).toContain(`aria-label="${c}"`);
    }
  });

  it("commander slot: the cost is icons, not raw text", () => {
    const commander: DeckCommander = {
      scryfallId: "c1",
      cardName: "Sonic the Hedgehog",
      typeLine: "Legendary Creature — Hedgehog Mercenary",
      manaCost: "{B}{B}{R}{R}",
      imageUri: null,
      artUri: null,
      colorIdentity: ["B", "R"],
    };
    const html = render(createElement(CommanderSlot, { deckId: "d1", commander, canEdit: false, alsoInDeckList: false }));
    expect(html).toContain('aria-label="Mana cost: Black, Black, Red, Red"');
    expect(html).not.toContain("{B}");
  });

  it("compare: changed card costs are icons", () => {
    const side = (id: string, cards: DeckCard[]) => ({
      id, name: id, format: "modern", cardCount: 1, ownerUsername: null, commander: null, cards,
    });
    const html = render(
      createElement(CompareView, {
        source: side("a", []),
        branch: side("b", [{ ...card, manaCost: "{X}{B/P}" }]),
        isPreferred: false,
        canSetPreferred: false,
      }),
    );
    expect(html).toContain('aria-label="Mana cost: X generic mana, Phyrexian Black"');
  });
});
