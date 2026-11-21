import { afterEach, describe, expect, it, vi } from "vitest";
import { buildImportedDeck } from "@/lib/decklist/build";
import { cardNameMatchKey, printedFaceNames } from "@/lib/decklist/names";
import { parseDecklist } from "@/lib/decklist/parse";
import {
  SCRYFALL_COLLECTION_LIMIT,
  getScryfallCardsByName,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import type { DeckFormat } from "@/lib/types";

// Deck import asks Scryfall's collection endpoint for exact names. That
// endpoint indexes each face of a multi-face card, not the combined
// "A // B" string (card search does). These fixtures reproduce that:
// a combined name is not found unless the card is indexed only that way.

type FetchInit = RequestInit & { signal?: AbortSignal };

interface Fixture {
  card: ScryfallCard;
  /** Indexed only under the combined name, not under each face. */
  fullNameOnly?: boolean;
}

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function faceCard(
  n: number,
  layoutName: string,
  front: string,
  back: string,
  frontType: string,
  backType: string,
): Fixture {
  const name = `${front} // ${back}`;
  return {
    card: {
      id: id(n),
      name,
      type_line: `${frontType} // ${backType}`,
      color_identity: ["W"],
      card_faces: [
        { name: front, type_line: frontType, mana_cost: "{W}" },
        { name: back, type_line: backType, mana_cost: "{1}{W}" },
      ],
    },
  };
}

const AJANI = faceCard(
  1,
  "transform",
  "Ajani, Nacatl Pariah",
  "Ajani, Nacatl Avenger",
  "Legendary Creature — Cat Warrior",
  "Legendary Planeswalker — Ajani",
);
const DELVER = faceCard(
  2,
  "transform",
  "Delver of Secrets",
  "Insectile Aberration",
  "Creature — Human Wizard",
  "Creature — Insect",
);
const VALKI = faceCard(
  3,
  "modal_dfc",
  "Valki, God of Lies",
  "Tibalt, Cosmic Impostor",
  "Legendary Creature — God",
  "Legendary Planeswalker — Tibalt",
);
const FIRE = faceCard(4, "split", "Fire", "Ice", "Instant", "Instant");
const BONECRUSHER = faceCard(
  5,
  "adventure",
  "Bonecrusher Giant",
  "Stomp",
  "Creature — Giant",
  "Instant — Adventure",
);
const NEZUMI = faceCard(
  6,
  "flip",
  "Nezumi Graverobber",
  "Nighteyes the Desecrator",
  "Creature — Rat Rogue",
  "Legendary Creature — Rat Wizard",
);
const BRUNA: Fixture = {
  card: {
    id: id(7),
    name: "Bruna, the Fading Light",
    type_line: "Legendary Creature — Angel Horror",
    mana_cost: "{5}{W}{W}",
    color_identity: ["W"],
    all_parts: [
      { name: "Bruna, the Fading Light", component: "meld_part" },
      { name: "Gisela, the Broken Blade", component: "meld_part" },
      { name: "Brisela, Voice of Nightmares", component: "meld_result" },
    ],
  },
};
const BRISELA: Fixture = {
  card: {
    id: id(8),
    name: "Brisela, Voice of Nightmares",
    type_line: "Legendary Creature — Eldrazi Angel",
    mana_cost: "{11}",
    color_identity: ["W"],
    all_parts: BRUNA.card.all_parts,
  },
};
const WHO: Fixture = {
  fullNameOnly: true,
  card: {
    id: id(9),
    name: "Who // What // When // Where // Why",
    type_line: "Instant // Instant // Instant // Instant // Instant",
    color_identity: ["W", "U", "B", "R", "G"],
    card_faces: ["Who", "What", "When", "Where", "Why"].map((name) => ({
      name,
      type_line: "Instant",
      mana_cost: "{X}",
    })),
  },
};
const SPDR: Fixture = {
  card: {
    id: id(10),
    name: "SP//dr, Piloted by Peni",
    type_line: "Legendary Artifact — Vehicle",
    mana_cost: "{3}",
    color_identity: [],
  },
};
const CHOCO: Fixture = {
  card: {
    id: id(11),
    name: "Summon: Choco/Mog",
    type_line: "Enchantment Creature — Saga Moogle",
    mana_cost: "{2}{G}",
    color_identity: ["G"],
  },
};
const LIM: Fixture = {
  card: {
    id: id(12),
    name: "Lim-Dûl's Vault",
    type_line: "Instant",
    mana_cost: "{U}{B}",
    color_identity: ["U", "B"],
  },
};
const SEANCE: Fixture = {
  card: {
    id: id(13),
    name: "Séance",
    type_line: "Enchantment",
    mana_cost: "{2}{W}{W}",
    color_identity: ["W"],
  },
};
const RIN: Fixture = {
  card: {
    id: id(14),
    name: "Rin and Seri, Inseparable",
    type_line: "Legendary Creature — Dog Cat",
    mana_cost: "{1}{R}{G}{W}",
    color_identity: ["R", "G", "W"],
    colors: ["R", "G", "W"],
  },
};
const SOL: Fixture = {
  card: { id: id(15), name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}", color_identity: [] },
};
const BOLT: Fixture = {
  card: {
    id: id(16),
    name: "Lightning Bolt",
    type_line: "Instant",
    mana_cost: "{R}",
    color_identity: ["R"],
  },
};
const FOREST: Fixture = {
  card: {
    id: id(17),
    name: "Forest",
    type_line: "Basic Land — Forest",
    color_identity: ["G"],
    colors: ["G"],
  },
};

const CATALOG: Fixture[] = [
  AJANI,
  DELVER,
  VALKI,
  FIRE,
  BONECRUSHER,
  NEZUMI,
  BRUNA,
  BRISELA,
  WHO,
  SPDR,
  CHOCO,
  LIM,
  SEANCE,
  RIN,
  SOL,
  BOLT,
  FOREST,
];

function accepts(query: string, fixture: Fixture): boolean {
  const key = cardNameMatchKey(query);
  if (!key) return false;
  if (fixture.fullNameOnly) return cardNameMatchKey(fixture.card.name) === key;
  const faces = (fixture.card.card_faces ?? [])
    .map((face) => face.name)
    .filter((name): name is string => Boolean(name));
  // Two or more faces: collection hits a face, and misses the combined name.
  if (faces.length >= 2) return faces.some((face) => cardNameMatchKey(face) === key);
  return cardNameMatchKey(fixture.card.name) === key;
}

function installCollection() {
  const fetch = vi.fn(async (url: string, init: FetchInit) => {
    expect(String(url)).toBe("https://api.scryfall.com/cards/collection");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body)) as { identifiers: { name: string }[] };
    expect(body.identifiers.length).toBeLessThanOrEqual(SCRYFALL_COLLECTION_LIMIT);
    const data: ScryfallCard[] = [];
    const notFound: { name: string }[] = [];
    for (const identifier of body.identifiers) {
      const fixture = CATALOG.find((entry) => accepts(identifier.name, entry));
      if (fixture) data.push(fixture.card);
      else notFound.push(identifier);
    }
    return Response.json({ object: "list", data, not_found: notFound });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentNames(fetch: ReturnType<typeof installCollection>): string[] {
  return fetch.mock.calls.flatMap((call) => {
    const body = JSON.parse(String(call[1].body)) as { identifiers: { name: string }[] };
    return body.identifiers.map((identifier) => identifier.name);
  });
}

async function resolveList(list: string, format: DeckFormat = "modern") {
  const parsed = parseDecklist(list, { commanderBlankLine: format === "commander" });
  const names = [...parsed.commanders, ...parsed.cards].map((card) => card.name);
  const found = await getScryfallCardsByName(names, { gapMs: 0 });
  return { parsed, found, built: buildImportedDeck({ format, parsed, found }) };
}

function variants(front: string, back: string): Array<[string, string]> {
  const full = `${front} // ${back}`;
  return [
    ["full name", full],
    ["front face", front],
    ["spaced single slash", `${front} / ${back}`],
    ["slash without spaces", `${front}/${back}`],
    ["double slash without spaces", `${front}//${back}`],
    ["uneven spaces", `${front}// ${back}`],
    ["case", full.toUpperCase()],
    ["extra whitespace", `  ${front}   //\t${back}  `],
    ["punctuation", full.replace(/[,']/g, "")],
  ];
}

const LAYOUTS: Array<{ layout: string; front: string; back: string; canonical: string }> = [
  {
    layout: "transform",
    front: "Ajani, Nacatl Pariah",
    back: "Ajani, Nacatl Avenger",
    canonical: AJANI.card.name,
  },
  {
    layout: "modal_dfc",
    front: "Valki, God of Lies",
    back: "Tibalt, Cosmic Impostor",
    canonical: VALKI.card.name,
  },
  { layout: "split", front: "Fire", back: "Ice", canonical: FIRE.card.name },
  {
    layout: "adventure",
    front: "Bonecrusher Giant",
    back: "Stomp",
    canonical: BONECRUSHER.card.name,
  },
  {
    layout: "flip",
    front: "Nezumi Graverobber",
    back: "Nighteyes the Desecrator",
    canonical: NEZUMI.card.name,
  },
];

describe("multi-face import names", () => {
  for (const layout of LAYOUTS) {
    describe(layout.layout, () => {
      for (const [label, written] of variants(layout.front, layout.back)) {
        it(`resolves ${label}`, async () => {
          installCollection();
          const { built } = await resolveList(`1 ${written}\n`);
          expect(built.warnings.filter((warning) => warning.startsWith("Couldn't find"))).toEqual([]);
          expect(built.cards).toEqual([
            expect.objectContaining({ cardName: layout.canonical, quantity: 1 }),
          ]);
        });
      }
    });
  }

  describe("meld", () => {
    const combined = "Bruna, the Fading Light // Brisela, Voice of Nightmares";
    for (const [label, written] of [
      ["front face", "Bruna, the Fading Light"],
      ["meld result", "Brisela, Voice of Nightmares"],
      ["full name", combined],
      ["spaced single slash", "Bruna, the Fading Light / Brisela, Voice of Nightmares"],
      ["double slash without spaces", "Bruna, the Fading Light//Brisela, Voice of Nightmares"],
      ["case", combined.toUpperCase()],
      ["extra whitespace", "  Bruna,   the Fading Light   //   Brisela, Voice of Nightmares  "],
      ["punctuation", "Bruna the Fading Light // Brisela Voice of Nightmares"],
    ] as const) {
      it(`resolves ${label}`, async () => {
        installCollection();
        const { built } = await resolveList(`1 ${written}\n`);
        const expected = label === "meld result" ? BRISELA.card.name : BRUNA.card.name;
        expect(built.warnings.filter((warning) => warning.startsWith("Couldn't find"))).toEqual([]);
        expect(built.cards.map((card) => card.cardName)).toEqual([expected]);
      });
    }
  });

  it("still sends a combined name that collection indexes only as a whole", async () => {
    const fetch = installCollection();
    const { built } = await resolveList("1 Who // What // When // Where // Why\n");
    expect(sentNames(fetch)).toContain("Who // What // When // Where // Why");
    expect(built.cards.map((card) => card.cardName)).toEqual([WHO.card.name]);
  });

  it("keeps a single-faced name that merely contains a slash", async () => {
    const fetch = installCollection();
    const spdr = await resolveList("1 SP//dr, Piloted by Peni\n");
    expect(sentNames(fetch)).toContain("SP // dr, Piloted by Peni");
    expect(spdr.built.cards.map((card) => card.cardName)).toEqual([SPDR.card.name]);

    const choco = await resolveList("1 Summon: Choco / Mog\n");
    expect(choco.built.cards.map((card) => card.cardName)).toEqual([CHOCO.card.name]);
  });

  it("does not turn a made-up back face into the front card", async () => {
    installCollection();
    const { built } = await resolveList("1 Sol Ring // Not a Card\n1 Sol Ring\n");
    expect(built.warnings).toContain("Couldn't find Sol Ring // Not a Card on Scryfall.");
    expect(built.cards).toEqual([expect.objectContaining({ cardName: "Sol Ring", quantity: 1 })]);
  });
});

describe("collection lookup for multi-face names", () => {
  it("asks for the printed line and each face, and keeps one copy of the card", async () => {
    const fetch = installCollection();
    const found = await getScryfallCardsByName(
      ["Ajani, Nacatl Pariah // Ajani, Nacatl Avenger", "ajani, nacatl pariah // ajani, nacatl avenger"],
      { gapMs: 0 },
    );
    expect(found.map((card) => card.name)).toEqual([AJANI.card.name]);
    const names = sentNames(fetch);
    expect(names).toContain("Ajani, Nacatl Pariah // Ajani, Nacatl Avenger");
    expect(names).toContain("Ajani, Nacatl Pariah");
    expect(names).toContain("Ajani, Nacatl Avenger");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("batches expanded face names in groups of 75", async () => {
    const fetch = installCollection();
    const names = Array.from({ length: 30 }, (_, i) => `Alpha ${i} // Beta ${i}`);
    await getScryfallCardsByName(names, { gapMs: 0 });
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    const batches = fetch.mock.calls.map((call) => {
      const body = JSON.parse(String(call[1].body)) as { identifiers: { name: string }[] };
      return body.identifiers.map((identifier) => identifier.name);
    });
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(75);
    const flat = batches.flat();
    expect(flat).toHaveLength(90);
    expect(flat.filter((name) => name.startsWith("Alpha "))).toHaveLength(60);
  });
});

describe("import sections around multi-face cards", () => {
  it("keeps commander, quantities, set codes, and leaves the sideboard out", async () => {
    const fetch = installCollection();
    const { built, parsed } = await resolveList(
      `//Commander
1 Rin and Seri, Inseparable (IKO) 231

//Main
1 Sol Ring (C21) 263 *F*
4 Lightning Bolt
10 Forest
1 Ajani, Nacatl Pariah // Ajani, Nacatl Avenger
1 Fire // Ice (MH2) 123
1 Fire/Ice
2 Delver of Secrets
1 Delver of Secrets // Insectile Aberration

Sideboard
1 Rest in Peace (A25) 30
SB: 2 Path to Exile
`,
      "commander",
    );
    expect(parsed.commanders.map((card) => card.name)).toEqual(["Rin and Seri, Inseparable"]);
    expect(built.commander?.cardName).toBe("Rin and Seri, Inseparable");
    expect(built.cards.map((card) => [card.cardName, card.quantity])).toEqual([
      ["Sol Ring", 1],
      ["Lightning Bolt", 4],
      ["Forest", 10],
      [AJANI.card.name, 1],
      [FIRE.card.name, 2],
      [DELVER.card.name, 3],
    ]);
    expect(built.warnings.some((warning) => warning.startsWith("Couldn't find"))).toBe(false);
    expect(built.warnings.some((warning) => /Sideboard/.test(warning))).toBe(true);
    const names = sentNames(fetch);
    expect(names).not.toContain("Rest in Peace");
    expect(names).not.toContain("Path to Exile");
    expect(names.join("\n")).not.toMatch(/IKO|C21|MH2|\*F\*/);
    expect(built.colors).toEqual(["W", "R", "G"]);
  });

  it("reads a Moxfield commander before the blank line and a multi-face card after it", async () => {
    installCollection();
    const { built } = await resolveList(
      `1 Rin and Seri, Inseparable

1 Ajani, Nacatl Pariah // Ajani, Nacatl Avenger
1 Fire // Ice
`,
      "commander",
    );
    expect(built.commander?.cardName).toBe("Rin and Seri, Inseparable");
    expect(built.cards.map((card) => card.cardName)).toEqual([AJANI.card.name, FIRE.card.name]);
    expect(built.warnings).toEqual([]);
  });

  it("folds single-faced punctuation the same way, including a commander heading", async () => {
    installCollection();
    const { built } = await resolveList(
      `//Commander
1 Ajani Nacatl Pariah // Ajani Nacatl Avenger

//Instants
1 lim duls vault
1 Seance
`,
      "commander",
    );
    expect(built.commander?.cardName).toBe(AJANI.card.name);
    expect(built.cards.map((card) => card.cardName)).toEqual(["Lim-Dûl's Vault", "Séance"]);
    expect(built.warnings.filter((warning) => warning.startsWith("Couldn't find"))).toEqual([]);
  });
});

describe("printed face names", () => {
  it("splits the separators a list actually uses, and leaves a one-face name alone", () => {
    expect(printedFaceNames("Fire // Ice")).toEqual(["Fire", "Ice"]);
    expect(printedFaceNames("Fire//Ice")).toEqual(["Fire", "Ice"]);
    expect(printedFaceNames("Fire / Ice")).toEqual(["Fire", "Ice"]);
    expect(printedFaceNames("Fire/Ice")).toEqual(["Fire", "Ice"]);
    expect(printedFaceNames("Who // What // When // Where // Why")).toHaveLength(5);
    expect(printedFaceNames("Sol Ring")).toEqual([]);
    expect(printedFaceNames("a/b/c/d/e/f")).toEqual([]);
  });
});
