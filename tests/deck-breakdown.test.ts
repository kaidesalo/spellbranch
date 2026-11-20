import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeckBreakdownPanel } from "@/components/decks/deck-breakdown";
import {
  BENCHMARKS,
  GAME_CHANGER_NAMES,
  LIST_WEIGHT_MAX,
  MIN_COUNTED_CARDS,
  analyzeDeck,
  classifyCard,
  isGameChangerName,
  isLandOnlySearch,
  manaByTurn,
  type BreakdownCard,
  type BreakdownInput,
  type DeckBreakdown,
} from "@/lib/deck-breakdown";

const BANNED = [
  "DeckCheck",
  "Threat Index",
  "Omni-Score",
  "Omni Score",
  "Full Synopsis",
  "Rescan",
  "Mana Velocity",
  "Card Flow",
  "Critical Onset",
  "Win Compactness",
  "Plan Shielding",
  "Engine Recovery",
  "Assembly Velocity",
  "Proactive Denial",
  "Reactive Disruption",
  "Selection & Redundancy",
];

function card(
  cardName: string,
  manaCost: string | null,
  typeLine: string,
  oracleText: string,
  quantity = 1,
  board: BreakdownCard["board"] = "main",
): BreakdownCard {
  return { cardName, manaCost, typeLine, oracleText, quantity, board };
}

function commander(): BreakdownCard {
  return card("Grove Titan", "{3}{G}{G}", "Legendary Creature — Elemental", "Trample");
}

function baseInput(cards: BreakdownCard[], overrides: Partial<BreakdownInput> = {}): BreakdownInput {
  return {
    name: "Grove March",
    format: "commander",
    formatLabel: "Commander",
    isPrecon: true,
    colors: ["G"],
    commander: commander(),
    cards,
    ...overrides,
  };
}

/** A 99-card mono-green list plus the commander. Counts are chosen so the tiers are easy to check. */
function preconCards(): BreakdownCard[] {
  return [
    card("Forest", null, "Basic Land — Forest", "", 38),
    card("Sol Ring", "{1}", "Artifact", "{T}: Add {C}{C}."),
    card("Arcane Signet", "{2}", "Artifact", "{T}: Add one mana of any color in your commander's color identity."),
    card("Cultivate", "{2}{G}", "Sorcery", "Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle."),
    card("Rampant Growth", "{1}{G}", "Sorcery", "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle."),
    card("Llanowar Elves", "{G}", "Creature — Elf Druid", "{T}: Add {G}.", 4),
    card("Farseek", "{1}{G}", "Sorcery", "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle."),
    card("Kodama's Reach", "{2}{G}", "Sorcery", "Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle."),
    card("Harmonize", "{2}{G}", "Sorcery", "Draw three cards.", 8),
    card("Answer the Herd", "{1}{G}", "Instant", "Destroy target creature.", 8),
    card("Bramble End", "{3}{G}{G}", "Sorcery", "Destroy all creatures."),
    card("Canopy End", "{3}{G}{G}", "Sorcery", "Destroy all creatures."),
    card("Charging Boar", "{2}{G}", "Creature — Boar", "Haste", 6),
    card("Moss Ram", "{3}{G}{G}", "Creature — Beast", "Trample", 6),
    card("Regrowth", "{1}{G}", "Sorcery", "Return target card from your graveyard to your hand."),
    card("Eternal Witness", "{3}{G}{G}", "Creature — Human Shaman", "When this creature enters, return target card from your graveyard to your hand."),
    card("Heroic Intervention", "{1}{G}", "Instant", "Permanents you control gain hexproof and indestructible until end of turn."),
    card("Lightning Greaves", "{2}", "Artifact — Equipment", "Equipped creature has haste and shroud."),
    card("Seek the Glade", "{1}{G}", "Sorcery", "Search your library for a creature card, reveal it, put it into your hand, then shuffle."),
    card("Ancient Wurm", "{5}{G}{G}", "Creature — Wurm", "Trample", 8),
    card("Quiet Elk", "{4}{G}{G}", "Creature — Elk", "This creature can't block.", 8),
  ];
}

function ready(input: BreakdownInput): DeckBreakdown {
  const result = analyzeDeck(input);
  expect(result.status).toBe("ready");
  return result;
}

function row(result: DeckBreakdown, id: string) {
  const found = result.benchmarks.find((benchmark) => benchmark.id === id);
  if (!found) throw new Error(`missing benchmark ${id}`);
  return found;
}

function shell(extra: BreakdownCard[] = [], overrides: Partial<BreakdownInput> = {}): BreakdownInput {
  return baseInput(
    [
      card("Forest", null, "Basic Land — Forest", "", 24),
      card("Quiet Elk", "{4}{G}{G}", "Creature — Elk", "This creature can't block.", 8),
      ...extra,
    ],
    { isPrecon: false, name: "Shell", ...overrides },
  );
}

describe("rule tables", () => {
  it("tracks the 53-card Game Changers list and not cards that left it", () => {
    expect(GAME_CHANGER_NAMES).toHaveLength(53);
    expect(new Set(GAME_CHANGER_NAMES).size).toBe(53);
    expect(isGameChangerName("Farewell")).toBe(true);
    expect(isGameChangerName("Biorhythm")).toBe(true);
    expect(isGameChangerName("Tergrid, God of Fright")).toBe(true);
    expect(isGameChangerName("Tergrid's Lantern")).toBe(true);
    expect(isGameChangerName("Sol Ring")).toBe(false);
    expect(isGameChangerName("Deflecting Swat")).toBe(false);
    expect(isGameChangerName("Food Chain")).toBe(false);
    expect(isGameChangerName("Winota, Joiner of Forces")).toBe(false);
  });

  it("sums the benchmark ceilings to 80", () => {
    expect(LIST_WEIGHT_MAX).toBe(80);
    expect(BENCHMARKS).toHaveLength(13);
    expect(MIN_COUNTED_CARDS).toBe(20);
  });

  it("does not reuse another product's benchmark names", () => {
    const labels = BENCHMARKS.map((benchmark) => benchmark.label).join("\n");
    for (const banned of BANNED) expect(labels).not.toContain(banned);
  });
});

describe("card reading", () => {
  it("separates mana spells, tutors, sweeps, and mass land denial", () => {
    const ring = classifyCard(card("Sol Ring", "{1}", "Artifact", "{T}: Add {C}{C}."));
    expect(ring.ramp).toBe("rock");
    expect(ring.persistentMana).toBe(2);
    expect(ring.gameChanger).toBe(false);

    const cultivate = classifyCard(
      card("Cultivate", "{2}{G}", "Sorcery", "Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle."),
    );
    expect(cultivate.ramp).toBe("landSearch");
    expect(cultivate.persistentMana).toBe(2);
    expect(cultivate.tutor).toBe(false);
    expect(isLandOnlySearch("a Plains")).toBe(true);
    expect(isLandOnlySearch("a creature card")).toBe(false);

    const tutor = classifyCard(
      card("Demonic Tutor", "{1}{B}", "Sorcery", "Search your library for a card, put that card into your hand, then shuffle."),
    );
    expect(tutor.tutor).toBe(true);
    expect(tutor.ramp).toBeNull();
    expect(tutor.gameChanger).toBe(true);

    const wrath = classifyCard(card("Wrath of God", "{2}{W}{W}", "Sorcery", "Destroy all creatures. They can't be regenerated."));
    expect(wrath.sweep).toBe(true);
    expect(wrath.targeted).toBe(false);

    const swords = classifyCard(card("Swords to Plowshares", "{W}", "Instant", "Exile target creature. Its controller gains life equal to its power."));
    expect(swords.targeted).toBe(true);
    expect(swords.sweep).toBe(false);

    const armageddon = classifyCard(card("Armageddon", "{3}{W}", "Sorcery", "Destroy all lands."));
    expect(armageddon.massLandDenial).toBe(true);
    const strip = classifyCard(card("Strip Mine", null, "Land", "{T}, Sacrifice this land: Destroy target land."));
    expect(strip.massLandDenial).toBe(false);
    expect(strip.land).toBe(true);

    const moon = classifyCard(card("Blood Moon", "{2}{R}", "Enchantment", "Nonbasic lands are Mountains."));
    expect(moon.massLandDenial).toBe(true);

    const warp = classifyCard(card("Time Warp", "{3}{U}{U}", "Sorcery", "Target player takes an extra turn after this one."));
    expect(warp.extraTurn).toBe(true);

    const regrowth = classifyCard(card("Regrowth", "{1}{G}", "Sorcery", "Return target card from your graveyard to your hand."));
    expect(regrowth.recursion).toBe(true);
    expect(regrowth.targeted).toBe(false);

    const heist = classifyCard(
      card(
        "Great Train Heist",
        "{R}",
        "Instant",
        "Spree. + {2}{R} — Untap all creatures you control. If it's your combat phase, there is an additional combat phase after this phase. + {R} — Whenever a creature you control deals combat damage to that player this turn, create a tapped Treasure token.",
      ),
    );
    expect(heist.ramp).toBeNull();
    const aid = classifyCard(
      card("Ancestors' Aid", "{R}", "Instant", "Target creature gets +2/+0 and gains first strike until end of turn. Create a Treasure token."),
    );
    expect(aid.ramp).toBeNull();
    const pilferer = classifyCard(
      card("Impulsive Pilferer", "{R}", "Creature — Goblin", "When this creature dies, create a Treasure token."),
    );
    expect(pilferer.ramp).toBe("rock");
    const throne = classifyCard(
      card("Throne of Eldraine", "{4}", "Legendary Artifact", "{T}: Add four mana of the chosen color. Spend this mana only to cast monocolored spells of that color."),
    );
    expect(throne.ramp).toBe("rock");
    expect(throne.persistentMana).toBe(4);
  });

  it("counts real draw and skips draw triggers and opponent draws", () => {
    expect(classifyCard(card("Harmonize", "{2}{G}{G}", "Sorcery", "Draw three cards.")).draw).toBe(true);
    expect(
      classifyCard(
        card(
          "Rhystic Study",
          "{2}{U}",
          "Enchantment",
          "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
        ),
      ).draw,
    ).toBe(true);
    expect(
      classifyCard(card("Mentor", "{1}{W}", "Creature", "Whenever you draw a card, put a +1/+1 counter on this creature.")).draw,
    ).toBe(false);
    expect(classifyCard(card("Howling Mine", "{2}", "Artifact", "Each opponent draws a card.")).draw).toBe(false);
    expect(
      classifyCard(
        card(
          "Necropotence",
          "{B}{B}{B}",
          "Enchantment",
          "Skip your draw step. Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.",
        ),
      ).draw,
    ).toBe(true);
  });

  it("counts a mana rock from the turn after it can be cast", () => {
    expect(manaByTurn(38, [{ manaValue: 1, mana: 2 }]).slice(0, 3)).toEqual([1, 4, 5]);
  });
});

describe("mono-color precon", () => {
  const result = ready(baseInput(preconCards()));

  it("reads a Core midrange list and the same input twice", () => {
    expect(result.signals).toMatchObject({
      counted: 100,
      lands: 38,
      manaSpells: 10,
      cardDraw: 8,
      tutors: 1,
      earlyThreats: 6,
      suddenEndings: 0,
      targetedAnswers: 8,
      boardSweeps: 2,
      manaDenial: 0,
      shields: 2,
      graveyardReturn: 2,
      standaloneThreats: 13,
      gameChangers: 0,
      extraTurns: 0,
      combos: [],
      roleOverlap: 4,
    });
    expect(result.signals?.averageManaValue).toBeCloseTo(237 / 62, 5);
    expect(result.score).toBe(28);
    expect(result.maxScore).toBe(80);
    expect(result.bracket).toMatchObject({ value: 2, name: "Core" });
    expect(result.archetype).toBe("Midrange");
    expect(result.overview).toContain("Grove March");
    expect(result.overview).toContain("mono-green");
    expect(result.overview).toContain("Grove Titan");
    expect(result.overview).toContain("official precon");
    expect(result.overview).toContain("List weight is 28");
    expect(result.overview).toContain("Bracket 2");
    expect(result.speed).toContain("around turn 3");
    expect(result.speed).toContain("around turn 2");
    expect(result.keyCards[0]).toMatchObject({ cardName: "Grove Titan" });
    expect(result.keyCards.map((item) => item.cardName)).toContain("Sol Ring");
    expect(result.weaknesses?.critical).toEqual([]);
    expect(result.weaknesses?.minor).toEqual([]);
    expect(result.weaknesses?.moderate.join(" ")).toContain("One color narrows");
    expect(analyzeDeck(baseInput(preconCards()))).toEqual(result);
  });

  it("assigns the benchmark letters for that list", () => {
    expect(row(result, "manaSpells")).toMatchObject({ letter: "B", points: 5 });
    expect(row(result, "cardDraw")).toMatchObject({ letter: "B", points: 4 });
    expect(row(result, "tutors")).toMatchObject({ letter: "D", points: 1 });
    expect(row(result, "roleOverlap")).toMatchObject({ letter: "A", points: 3 });
    expect(row(result, "earlyThreats")).toMatchObject({ letter: "C", points: 2 });
    expect(row(result, "suddenEndings")).toMatchObject({ letter: "F", points: 0 });
    expect(row(result, "nonlandCurve")).toMatchObject({ letter: "C", points: 2 });
    expect(row(result, "targetedAnswers")).toMatchObject({ letter: "B", points: 4 });
    expect(row(result, "boardSweeps")).toMatchObject({ letter: "C", points: 2 });
    expect(row(result, "manaDenial")).toMatchObject({ letter: "F", points: 0 });
    expect(row(result, "shields")).toMatchObject({ letter: "C", points: 1 });
    expect(row(result, "graveyardReturn")).toMatchObject({ letter: "C", points: 1 });
    expect(row(result, "standaloneThreats")).toMatchObject({ letter: "A", points: 3 });
  });

  it("does not pin a precon to Bracket 2 when the list has a Game Changer", () => {
    const withFarewell = ready(
      baseInput([
        ...preconCards(),
        card(
          "Farewell",
          "{4}{W}{W}",
          "Sorcery",
          "Choose one or more. Exile all artifacts. Exile all creatures. Exile all enchantments. Exile all graveyards.",
        ),
      ]),
    );
    expect(withFarewell.bracket?.value).toBe(3);
    expect(withFarewell.overview).toContain("official precon");
    expect(withFarewell.signals?.gameChangerNames).toContain("Farewell");
  });
});

describe("ramp-heavy deck", () => {
  it("scores mana spells higher than the precon and casts the commander no later", () => {
    const precon = ready(baseInput(preconCards()));
    const cards = preconCards().map((item) =>
      item.cardName === "Ancient Wurm"
        ? card("Worn Helm", "{2}", "Artifact", "{T}: Add {G}.", item.quantity)
        : item,
    );
    const ramp = ready(baseInput(cards, { name: "Helm Ramp", isPrecon: false }));
    expect(row(ramp, "manaSpells").letter).toBe("S");
    expect(row(ramp, "manaSpells").points).toBeGreaterThan(row(precon, "manaSpells").points);
    expect(ramp.score).toBeGreaterThan(precon.score ?? 0);
    expect(ramp.signals?.manaSpells).toBe(18);
    expect(ramp.speed).toContain("around turn 3");
  });
});

describe("low-interaction deck", () => {
  it("flags scarce answers as a critical weakness", () => {
    const cards = preconCards().flatMap((item) => {
      if (item.cardName === "Answer the Herd" || item.cardName === "Bramble End" || item.cardName === "Canopy End") {
        return [];
      }
      return [item];
    });
    cards.push(card("Watchful Elk", "{2}{G}", "Creature — Elk", "Vigilance", 10));
    const result = ready(baseInput(cards, { name: "Quiet Grove", isPrecon: false }));
    expect(row(result, "targetedAnswers")).toMatchObject({ letter: "F", points: 0 });
    expect(row(result, "boardSweeps")).toMatchObject({ letter: "F", points: 0 });
    expect(result.weaknesses?.critical.join(" ")).toContain("Targeted answers are scarce");
    expect(result.weaknesses?.critical.join(" ")).not.toContain("Card draw is nearly absent");
    expect(result.primer?.tips.join(" ")).toContain("Targeted answers are scarce");
  });
});

describe("bracket card rules", () => {
  it("uses Game Changer counts, mass land denial, combos, and extra turns", () => {
    const three = ready(
      shell([
        card("Demonic Tutor", "{1}{B}", "Sorcery", "Search your library for a card, put that card into your hand, then shuffle."),
        card("Rhystic Study", "{2}{U}", "Enchantment", "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."),
        card("Cyclonic Rift", "{1}{U}", "Instant", "Return target nonland permanent you don't control to its owner's hand. Overload {6}{U}"),
      ]),
    );
    expect(three.bracket?.value).toBe(3);
    expect(three.signals?.gameChangers).toBe(3);

    const four = ready(
      shell([
        card("Demonic Tutor", "{1}{B}", "Sorcery", "Search your library for a card, put that card into your hand, then shuffle."),
        card("Rhystic Study", "{2}{U}", "Enchantment", "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."),
        card("Cyclonic Rift", "{1}{U}", "Instant", "Return target nonland permanent you don't control to its owner's hand. Overload {6}{U}"),
        card("Smothering Tithe", "{3}{W}", "Enchantment", "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token."),
      ]),
    );
    expect(four.bracket?.value).toBe(4);

    const denial = ready(shell([card("Armageddon", "{3}{W}", "Sorcery", "Destroy all lands.")]));
    expect(denial.bracket?.value).toBe(4);
    expect(row(denial, "manaDenial").letter).toBe("C");

    const mine = ready(shell([card("Strip Mine", null, "Land", "{T}, Sacrifice this land: Destroy target land.")]));
    expect(mine.bracket?.value).toBe(2);
    expect(mine.signals?.manaDenial).toBe(0);

    const early = ready(
      shell([
        card("Thassa's Oracle", "{U}{U}", "Creature — Merfolk Wizard", "When this creature enters, if you have no cards in your library, you win the game."),
        card("Demonic Consultation", "{B}", "Instant", "Name a card. Exile the top six cards of your library. If you exile the named card, put it into your hand."),
      ]),
    );
    expect(early.signals?.combos[0]).toMatchObject({ a: "Thassa's Oracle", b: "Demonic Consultation", early: true });
    expect(early.bracket?.value).toBe(4);

    const late = ready(
      shell([
        card("Exquisite Blood", "{4}{B}", "Enchantment", "Whenever an opponent loses life, you gain that much life."),
        card("Sanguine Bond", "{3}{B}{B}", "Enchantment", "Whenever you gain life, target opponent loses that much life."),
      ]),
    );
    expect(late.signals?.combos[0]?.early).toBe(false);
    expect(late.bracket?.value).toBe(3);

    const oneTurn = ready(
      shell([card("Time Warp", "{3}{U}{U}", "Sorcery", "Target player takes an extra turn after this one.")]),
    );
    expect(oneTurn.bracket?.value).toBe(2);
    expect(oneTurn.bracket?.reasons.join(" ")).toContain("extra-turn");

    const chained = ready(
      shell([card("Time Warp", "{3}{U}{U}", "Sorcery", "Target player takes an extra turn after this one.", 3)]),
    );
    expect(chained.bracket?.value).toBe(4);

    const tergrid = ready(
      shell([], {
        commander: card("Tergrid, God of Fright", "{3}{B}{B}", "Legendary Creature — God", ""),
        colors: ["B"],
      }),
    );
    expect(tergrid.signals?.gameChangers).toBe(1);
    expect(tergrid.bracket?.value).toBe(3);
  });
});

describe("not enough cards", () => {
  it("stays quiet for an empty list and a tiny list", () => {
    for (const input of [
      baseInput([], { commander: null, isPrecon: false, name: "Empty" }),
      baseInput([card("Forest", null, "Basic Land — Forest", "", 5)], { commander: null, isPrecon: false }),
      baseInput([card("Forest", null, "Basic Land — Forest", "", 4)]),
    ]) {
      const result = analyzeDeck(input);
      expect(result.status).toBe("insufficient");
      expect(result.score).toBeNull();
      expect(result.bracket).toBeNull();
      expect(result.benchmarks).toEqual([]);
      expect(result.keyCards).toEqual([]);
      expect(result.emptyMessage).toContain("Not enough cards");
      expect(result.emptyMessage).toContain(String(result.counted));
      expect(result.counted).toBeLessThan(MIN_COUNTED_CARDS);
    }
  });
});

describe("what the read ignores", () => {
  it("ignores sideboard and maybeboard cards", () => {
    const result = ready(
      shell([
        card("Swords to Plowshares", "{W}", "Instant", "Exile target creature.", 8, "side"),
        card("Wrath of God", "{2}{W}{W}", "Sorcery", "Destroy all creatures.", 4, "maybe"),
      ]),
    );
    expect(result.signals?.targetedAnswers).toBe(0);
    expect(result.signals?.boardSweeps).toBe(0);
  });

  it("does not assign a Commander bracket outside Commander", () => {
    const result = ready(
      baseInput(
        [
          card("Island", null, "Basic Land — Island", "", 24),
          card("Think Twice", "{1}{U}", "Instant", "Draw a card.", 16),
        ],
        { format: "modern", formatLabel: "Modern", commander: null, colors: ["U"], isPrecon: false, name: "Blue Tempo" },
      ),
    );
    expect(result.bracket).toBeNull();
    expect(result.overview).toContain("Commander brackets are a Commander tool");
    expect(result.score).not.toBeNull();
  });

  it("keeps the same letters when the list is half as long with the same ratios", () => {
    const full = ready(
      baseInput(
        [
          card("Forest", null, "Basic Land — Forest", "", 40),
          card("Llanowar Elves", "{G}", "Creature — Elf Druid", "{T}: Add {G}.", 10),
          card("Harmonize", "{2}{G}{G}", "Sorcery", "Draw three cards.", 10),
          card("Answer the Herd", "{1}{G}", "Instant", "Destroy target creature.", 10),
          card("Charging Boar", "{2}{G}", "Creature — Boar", "Haste", 10),
          card("Quiet Elk", "{4}{G}{G}", "Creature — Elk", "This creature can't block.", 20),
        ],
        { commander: null, isPrecon: false, colors: ["G"] },
      ),
    );
    const half = ready(
      baseInput(
        [
          card("Forest", null, "Basic Land — Forest", "", 20),
          card("Llanowar Elves", "{G}", "Creature — Elf Druid", "{T}: Add {G}.", 5),
          card("Harmonize", "{2}{G}{G}", "Sorcery", "Draw three cards.", 5),
          card("Answer the Herd", "{1}{G}", "Instant", "Destroy target creature.", 5),
          card("Charging Boar", "{2}{G}", "Creature — Boar", "Haste", 5),
          card("Quiet Elk", "{4}{G}{G}", "Creature — Elk", "This creature can't block.", 10),
        ],
        { commander: null, isPrecon: false, colors: ["G"] },
      ),
    );
    expect(half.counted).toBe(50);
    expect(full.benchmarks.map((item) => [item.id, item.letter, item.points])).toEqual(
      half.benchmarks.map((item) => [item.id, item.letter, item.points]),
    );
    expect(half.score).toBe(full.score);
  });
});

describe("deck breakdown panel", () => {
  it("renders the precon read and the empty state without another product's words", () => {
    const filled = renderToStaticMarkup(createElement(DeckBreakdownPanel, { breakdown: ready(baseInput(preconCards())) }));
    expect(filled).toContain("Deck breakdown");
    expect(filled).toContain("Overview");
    expect(filled).toContain("Primer");
    expect(filled).toContain("Core strategy");
    expect(filled).toContain("Keep:");
    expect(filled).toContain("Avoid:");
    expect(filled).toContain("Weaknesses");
    expect(filled).toContain("Key cards");
    expect(filled).toContain("Benchmarks");
    expect(filled).toContain("How to read list weight");
    expect(filled).toContain("List weight");
    expect(filled).toContain("Bracket 2");
    expect(filled).toContain(">28<");
    expect(filled).toContain("Card access");
    expect(filled).not.toContain("<button");

    const empty = renderToStaticMarkup(
      createElement(DeckBreakdownPanel, {
        breakdown: analyzeDeck(baseInput([], { commander: null, name: "Empty", isPrecon: false })),
      }),
    );
    expect(empty).toContain("deck-breakdown-empty");
    expect(empty).toContain("Not enough cards");
    expect(empty).not.toContain("List weight");

    const blob = `${filled}\n${empty}\n${JSON.stringify(ready(baseInput(preconCards())))}`;
    for (const banned of BANNED) expect(blob).not.toContain(banned);
  });
});
