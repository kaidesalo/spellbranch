import { describe, expect, it } from "vitest";
import { buildImportedDeck } from "@/lib/decklist/build";
import { decklistFilename, exportDecklist } from "@/lib/decklist/export";
import { parseDecklist, pastedListProblem } from "@/lib/decklist/parse";
import type { ScryfallCard } from "@/lib/scryfall/client";

// Moxfield plain text, Archidekt category text, and the list we hand back.
// Commander, quantities and basic lands are the shapes people paste.

const commander = { commanderBlankLine: true };

describe("pasted deck URLs", () => {
  it("refuses Moxfield and Archidekt links instead of fetching them", () => {
    const mox = pastedListProblem("https://moxfield.com/decks/CFeCQ5NOMESJOSSGLB8cPg");
    const www = pastedListProblem("https://www.moxfield.com/decks/abc");
    const api = pastedListProblem("https://api2.moxfield.com/v3/decks/all/abc");
    const arch = pastedListProblem("https://archidekt.com/decks/19345263/yurikoninjas_v3");
    const archWww = pastedListProblem("https://www.archidekt.com/decks/42");
    expect(mox).toMatch(/Plain Text/);
    expect(www).toBe(mox);
    expect(api).toBe(mox);
    expect(arch).toMatch(/Export → Text/);
    expect(archWww).toBe(arch);
    for (const message of [mox, arch]) {
      expect(message).not.toMatch(/https?:/);
      expect(message).not.toMatch(/cookie|token|cf_clearance/i);
    }
  });

  it("does not echo credentials and does not treat a lookalike host as Moxfield", () => {
    const leaked = pastedListProblem("https://user:secret-token@moxfield.com/decks/abc");
    expect(leaked).toMatch(/Plain Text/);
    expect(leaked).not.toContain("secret-token");
    expect(leaked).not.toContain("user");
    const lookalike = pastedListProblem("https://moxfield.com.evil.example/decks/abc");
    expect(lookalike).toBe("Paste the deck list itself, not a link.");
    expect(pastedListProblem("https://evil.example/?next=https://moxfield.com/decks/1")).toBe(
      "Paste the deck list itself, not a link.",
    );
    expect(pastedListProblem("https://archidekt.com.evil.example/decks/1")).toBe(
      "Paste the deck list itself, not a link.",
    );
  });

  it("still parses a list that merely mentions a URL on its own line", () => {
    expect(pastedListProblem("1 Sol Ring\nhttps://moxfield.com/decks/abc")).toBeNull();
    const parsed = parseDecklist("1 Sol Ring\nhttps://moxfield.com/decks/abc\n10 Forest");
    expect(parsed.cards).toEqual([
      { name: "Sol Ring", quantity: 1 },
      { name: "Forest", quantity: 10 },
    ]);
    expect(parsed.warnings.some((warning) => warning.includes("a link"))).toBe(true);
  });
});

describe("parseDecklist", () => {
  it("reads Moxfield plain text: commander, quantities, and basic lands", () => {
    const parsed = parseDecklist(
      `1 Atraxa, Praetors' Voice

1 Sol Ring
1x Arcane Signet
4 Lightning Bolt
10 Forest
20 Island
1 Snow-Covered Island
7 Wastes
1 Plains
1 Swamp
1 Mountain
`,
      commander,
    );
    expect(parsed.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
    expect(parsed.cards).toEqual([
      { name: "Sol Ring", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Lightning Bolt", quantity: 4 },
      { name: "Forest", quantity: 10 },
      { name: "Island", quantity: 20 },
      { name: "Snow-Covered Island", quantity: 1 },
      { name: "Wastes", quantity: 7 },
      { name: "Plains", quantity: 1 },
      { name: "Swamp", quantity: 1 },
      { name: "Mountain", quantity: 1 },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("keeps a name that starts with X, and merges basic lands", () => {
    const parsed = parseDecklist("1 Xenagos, the Reveler\n1 Forest\n10 Forest\n4X Lightning Bolt");
    expect(parsed.commanders).toEqual([]);
    expect(parsed.cards).toEqual([
      { name: "Xenagos, the Reveler", quantity: 1 },
      { name: "Forest", quantity: 11 },
      { name: "Lightning Bolt", quantity: 4 },
    ]);
  });

  it("does not treat a blank line as a commander unless asked", () => {
    const text = "1 Sol Ring\n\n10 Forest";
    expect(parseDecklist(text).commanders).toEqual([]);
    expect(parseDecklist(text, commander).commanders).toEqual([{ name: "Sol Ring", quantity: 1 }]);
    expect(parseDecklist(text, commander).cards).toEqual([{ name: "Forest", quantity: 10 }]);
  });

  it("reads two commanders before the blank line (Moxfield partners)", () => {
    const parsed = parseDecklist(
      `1 Tymna the Weaver
1 Thrasios, Triton Hero

1 Sol Ring
`,
      commander,
    );
    expect(parsed.commanders.map((card) => card.name)).toEqual([
      "Tymna the Weaver",
      "Thrasios, Triton Hero",
    ]);
    expect(parsed.cards).toEqual([{ name: "Sol Ring", quantity: 1 }]);
  });

  it("reads Archidekt categories, set codes, and leaves the maybeboard out", () => {
    const parsed = parseDecklist(
      `//Commander
1 Atraxa, Praetors' Voice

//Artifacts
1x Sol Ring (CMR) 317
1 Arcane Signet (C21) 263 *F*

//Lands
10 Forest
1 Command Tower

//Maybeboard
1 Cyclonic Rift
`,
      commander,
    );
    expect(parsed.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
    expect(parsed.cards).toEqual([
      { name: "Sol Ring", quantity: 1 },
      { name: "Arcane Signet", quantity: 1 },
      { name: "Forest", quantity: 10 },
      { name: "Command Tower", quantity: 1 },
    ]);
    expect(parsed.warnings).toEqual([
      "Skipped 1 card from Maybeboard. Those piles aren't part of the Spellbranch deck.",
    ]);
  });

  it("reads a commander tag, Arena sideboards, and SB: lines", () => {
    const tagged = parseDecklist("1 Atraxa, Praetors' Voice *CMDR*\n1 Sol Ring\n10 Forest");
    expect(tagged.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
    expect(tagged.cards.map((card) => card.name)).toEqual(["Sol Ring", "Forest"]);

    const arena = parseDecklist(
      `Deck
1 Sol Ring (C21) 263

Sideboard
1 Rest in Peace (A25) 30
SB: 2 Path to Exile
`,
    );
    expect(arena.cards).toEqual([{ name: "Sol Ring", quantity: 1 }]);
    expect(arena.warnings[0]).toMatch(/Skipped 3 cards from Sideboard/);
  });

  it("folds a curly apostrophe and a double-faced name into the printed form", () => {
    const parsed = parseDecklist("1 Atraxa, Praetors\u2019 Voice\n1 Fire//Ice (MH2) 123");
    expect(parsed.cards.map((card) => card.name)).toEqual([
      "Atraxa, Praetors' Voice",
      "Fire // Ice",
    ]);
  });

  it("caps a huge basic-land count", () => {
    const parsed = parseDecklist("250 Forest");
    expect(parsed.cards).toEqual([{ name: "Forest", quantity: 99 }]);
    expect(parsed.warnings[0]).toMatch(/Forest was brought down to 99/);
  });

  it("accepts a bare name as one copy", () => {
    expect(parseDecklist("Sol Ring\nForest").cards).toEqual([
      { name: "Sol Ring", quantity: 1 },
      { name: "Forest", quantity: 1 },
    ]);
  });
});

describe("exportDecklist", () => {
  it("writes commander, then a blank line, then quantity lines including basics", () => {
    const text = exportDecklist({
      commanderName: "Atraxa, Praetors' Voice",
      cards: [
        { cardName: "Sol Ring", quantity: 1 },
        { cardName: "Forest", quantity: 10 },
        { cardName: "Arcane Signet", quantity: 1 },
        { cardName: "Island", quantity: 20 },
      ],
    });
    expect(text).toBe(
      `1 Atraxa, Praetors' Voice

1 Arcane Signet
10 Forest
20 Island
1 Sol Ring
`,
    );
    const parsed = parseDecklist(text, commander);
    expect(parsed.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
    expect(parsed.cards).toEqual([
      { name: "Arcane Signet", quantity: 1 },
      { name: "Forest", quantity: 10 },
      { name: "Island", quantity: 20 },
      { name: "Sol Ring", quantity: 1 },
    ]);
  });

  it("omits the commander block when the deck has none", () => {
    const text = exportDecklist({
      commanderName: null,
      cards: [
        { cardName: "Lightning Bolt", quantity: 4 },
        { cardName: "Island", quantity: 20 },
      ],
    });
    expect(text).toBe("20 Island\n4 Lightning Bolt\n");
    expect(parseDecklist(text, commander).commanders).toEqual([]);
  });

  it("keeps a commander that is also in the deck list", () => {
    const text = exportDecklist({
      commanderName: "Atraxa, Praetors' Voice",
      cards: [{ cardName: "Atraxa, Praetors' Voice", quantity: 1 }],
    });
    const parsed = parseDecklist(text, commander);
    expect(parsed.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
    expect(parsed.cards).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
  });

  it("builds a safe download name", () => {
    expect(decklistFilename("Atraxa / Voice")).toBe("Atraxa-Voice.txt");
    expect(decklistFilename("../../etc/passwd")).toBe("etc-passwd.txt");
    expect(decklistFilename("   ")).toBe("deck.txt");
  });
});

function card(over: Partial<ScryfallCard> & Pick<ScryfallCard, "id" | "name" | "type_line">): ScryfallCard {
  return {
    mana_cost: "{1}",
    oracle_text: "Oracle.",
    colors: [],
    color_identity: [],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/x/card.jpg",
      art_crop: "https://cards.scryfall.io/art_crop/front/x/card.jpg",
    },
    ...over,
  };
}

const ATRAXA = "11111111-2222-4333-8444-555555555555";
const SOL = "22222222-3333-4444-8555-666666666666";
const FOREST = "33333333-4444-4555-8666-777777777777";
const BOLT = "44444444-5555-4666-8777-888888888888";
const THRASIOS = "55555555-6666-4777-8888-999999999999";

describe("buildImportedDeck", () => {
  const atraxa = card({
    id: ATRAXA,
    name: "Atraxa, Praetors' Voice",
    mana_cost: "{G}{W}{U}{B}",
    type_line: "Legendary Creature — Phyrexian Angel Horror",
    colors: ["B", "G", "U", "W"],
    color_identity: ["B", "G", "U", "W"],
  });
  const sol = card({
    id: SOL,
    name: "Sol Ring",
    type_line: "Artifact",
    mana_cost: "{1}",
  });
  const forest = card({
    id: FOREST,
    name: "Forest",
    type_line: "Basic Land — Forest",
    colors: ["G"],
    color_identity: ["G"],
    mana_cost: "",
  });
  const bolt = card({
    id: BOLT,
    name: "Lightning Bolt",
    type_line: "Instant",
    mana_cost: "{R}",
    colors: ["R"],
    color_identity: ["R"],
  });

  it("maps commander, quantity and basic land through Scryfall's own fields", () => {
    const parsed = parseDecklist(
      "1 Atraxa, Praetors\u2019 Voice\n\n1 Sol Ring\n10 Forest\n",
      commander,
    );
    const built = buildImportedDeck({
      format: "commander",
      parsed,
      found: [atraxa, sol, forest],
    });
    expect(built.commander?.cardName).toBe("Atraxa, Praetors' Voice");
    expect(built.commander?.colorIdentity).toEqual(["W", "U", "B", "G"]);
    expect(built.cards.map((row) => [row.cardName, row.quantity, row.scryfallId])).toEqual([
      ["Sol Ring", 1, SOL],
      ["Forest", 10, FOREST],
    ]);
    expect(built.colors).toEqual(["W", "U", "B", "G"]);
    expect(built.warnings).toEqual([]);
  });

  it("puts a non-legendary 'commander' and a second partner into the deck list", () => {
    const parsed = parseDecklist("1 Lightning Bolt\n1 Thrasios, Triton Hero\n\n1 Sol Ring\n", commander);
    // Blank line takes the first two lines. Override with an explicit heading instead.
    const headed = parseDecklist(
      "Commander\n1 Lightning Bolt\n1 Thrasios, Triton Hero\n\nDeck\n1 Sol Ring\n",
    );
    const thrasios = card({
      id: THRASIOS,
      name: "Thrasios, Triton Hero",
      type_line: "Legendary Creature — Merfolk Wizard",
      color_identity: ["G", "U"],
      colors: ["G", "U"],
    });
    const built = buildImportedDeck({
      format: "commander",
      parsed: headed,
      found: [bolt, thrasios, sol],
    });
    expect(built.commander?.cardName).toBe("Thrasios, Triton Hero");
    expect(built.cards.map((row) => row.cardName)).toEqual(["Lightning Bolt", "Sol Ring"]);
    expect(built.warnings.some((warning) => warning.includes("Lightning Bolt"))).toBe(true);
    expect(parsed.commanders).toHaveLength(2);
  });

  it("reports a name Scryfall didn't return and still keeps the rest", () => {
    const parsed = parseDecklist("1 Atraxa, Praetors' Voice\n\n1 Not a Real Card\n10 Forest\n", commander);
    const built = buildImportedDeck({ format: "commander", parsed, found: [atraxa, forest] });
    expect(built.commander?.cardName).toBe("Atraxa, Praetors' Voice");
    expect(built.cards.map((row) => row.cardName)).toEqual(["Forest"]);
    expect(built.warnings).toEqual(["Couldn't find Not a Real Card on Scryfall."]);
  });

  it("adds commander-section cards to the list when the format has no command zone", () => {
    const parsed = parseDecklist("Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n");
    const built = buildImportedDeck({ format: "modern", parsed, found: [atraxa, sol] });
    expect(built.commander).toBeNull();
    expect(built.cards.map((row) => row.cardName).sort()).toEqual([
      "Atraxa, Praetors' Voice",
      "Sol Ring",
    ]);
    expect(built.warnings[0]).toMatch(/no commander/);
  });

  it("matches a double-faced card by either face and does not store it twice", () => {
    const delver = card({
      id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      name: "Delver of Secrets // Insectile Aberration",
      type_line: "Creature — Human Wizard // Creature — Insect",
      card_faces: [
        { name: "Delver of Secrets", type_line: "Creature — Human Wizard" },
        { name: "Insectile Aberration", type_line: "Creature — Insect" },
      ],
    });
    const parsed = parseDecklist("1 Delver of Secrets\n1 Delver of Secrets // Insectile Aberration\n");
    const built = buildImportedDeck({ format: "modern", parsed, found: [delver] });
    expect(built.cards).toHaveLength(1);
    expect(built.cards[0]).toMatchObject({ cardName: delver.name, quantity: 2, scryfallId: delver.id });
  });
});
