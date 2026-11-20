import {
  classifyDeck,
  findCombos,
  perHundred,
  sumQuantity,
  type ClassifiedCard,
} from "@/lib/deck-breakdown/detect";
import { keyCardLines, overviewParagraph, primerFrom, speedLine, weaknessesFrom, type ProseFacts } from "@/lib/deck-breakdown/prose";
import {
  BENCHMARKS,
  BRACKET_NAMES,
  EARLY_COMBO_MANA_VALUE,
  EXTRA_TURNS_BEFORE_CHAINING,
  GAME_CHANGERS_IN_UPGRADED,
  LIST_WEIGHT_MAX,
  MIN_COUNTED_CARDS,
  ROLE_REPEAT_PER_HUNDRED,
  normalizeCardName,
  scoreTier,
} from "@/lib/deck-breakdown/rules";
import type {
  BenchmarkScore,
  BracketRead,
  BreakdownInput,
  BreakdownSignals,
  DeckBreakdown,
} from "@/lib/deck-breakdown/types";

/**
 * Reads a deck from the cards the page already has. Same input, same output.
 * No Scryfall call, no database write, no clock.
 */

function countPhrase(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function namesWhere(cards: readonly ClassifiedCard[], include: (card: ClassifiedCard) => boolean): string[] {
  return cards
    .filter(include)
    .map((card) => card.cardName)
    .sort((a, b) => a.localeCompare(b));
}

function uniqueNames(cards: readonly ClassifiedCard[], include: (card: ClassifiedCard) => boolean): ClassifiedCard[] {
  const seen = new Set<string>();
  const out: ClassifiedCard[] = [];
  for (const card of cards) {
    if (!include(card)) continue;
    const key = normalizeCardName(card.cardName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

function signalsFrom(cards: readonly ClassifiedCard[]): BreakdownSignals {
  const counted = sumQuantity(cards, () => true);
  const combos = findCombos(cards);
  const comboNames = new Set(combos.flatMap((combo) => [normalizeCardName(combo.a), normalizeCardName(combo.b)]));
  const extraTurns = sumQuantity(cards, (card) => card.extraTurn);
  const winCards = sumQuantity(
    cards,
    (card) => card.winsGame && !comboNames.has(normalizeCardName(card.cardName)),
  );
  const gameChangerCards = uniqueNames(cards, (card) => card.gameChanger);
  let spellMana = 0;
  let spellCount = 0;
  for (const card of cards) {
    if (card.land) continue;
    spellMana += card.manaValue * card.quantity;
    spellCount += card.quantity;
  }
  const lands = sumQuantity(cards, (card) => card.land);
  const manaSpells = sumQuantity(cards, (card) => card.ramp !== null);
  const cardDraw = sumQuantity(cards, (card) => card.draw);
  const targetedAnswers = sumQuantity(cards, (card) => card.targeted);
  const earlyThreats = sumQuantity(cards, (card) => card.earlyThreat);
  const graveyardReturn = sumQuantity(cards, (card) => card.recursion);
  const size = Math.max(counted, 1);
  const repeating = [
    perHundred(manaSpells, size),
    perHundred(cardDraw, size),
    perHundred(targetedAnswers, size),
    perHundred(earlyThreats, size),
    perHundred(graveyardReturn, size),
  ].filter((value) => value >= ROLE_REPEAT_PER_HUNDRED).length;

  return {
    counted,
    lands,
    manaSpells,
    cardDraw,
    tutors: sumQuantity(cards, (card) => card.tutor),
    earlyThreats,
    suddenEndings: extraTurns + combos.length + winCards,
    targetedAnswers,
    boardSweeps: sumQuantity(cards, (card) => card.sweep),
    manaDenial: sumQuantity(cards, (card) => card.massLandDenial),
    shields: sumQuantity(cards, (card) => card.shield),
    graveyardReturn,
    standaloneThreats: sumQuantity(cards, (card) => card.standalone),
    gameChangers: sumQuantity(cards, (card) => card.gameChanger),
    gameChangerNames: gameChangerCards.map((card) => card.cardName).sort((a, b) => a.localeCompare(b)),
    extraTurns,
    combos,
    averageManaValue: spellCount > 0 ? spellMana / spellCount : null,
    roleOverlap: repeating,
    counters: sumQuantity(cards, (card) => card.counter),
    tokenMakers: sumQuantity(cards, (card) => card.tokenMaker),
    aurasAndEquipment: sumQuantity(cards, (card) => card.auraOrEquipment),
    instantsAndSorceries: sumQuantity(cards, (card) => card.instantOrSorcery),
    creatures: sumQuantity(cards, (card) => card.creature),
  };
}

function benchmarkValue(id: string, signals: BreakdownSignals): number | null {
  const size = signals.counted;
  const scaled = (count: number) => perHundred(count, size);
  switch (id) {
    case "manaSpells":
      return scaled(signals.manaSpells);
    case "cardDraw":
      return scaled(signals.cardDraw);
    case "tutors":
      return scaled(signals.tutors);
    case "roleOverlap":
      return signals.roleOverlap;
    case "earlyThreats":
      return scaled(signals.earlyThreats);
    case "suddenEndings":
      return signals.suddenEndings;
    case "nonlandCurve":
      return signals.averageManaValue;
    case "targetedAnswers":
      return scaled(signals.targetedAnswers);
    case "boardSweeps":
      return scaled(signals.boardSweeps);
    case "manaDenial":
      return signals.manaDenial;
    case "shields":
      return scaled(signals.shields);
    case "graveyardReturn":
      return scaled(signals.graveyardReturn);
    case "standaloneThreats":
      return scaled(signals.standaloneThreats);
    default:
      return 0;
  }
}

function readingFor(id: string, signals: BreakdownSignals): string {
  switch (id) {
    case "manaSpells":
      return countPhrase(signals.manaSpells, "mana spell");
    case "cardDraw":
      return countPhrase(signals.cardDraw, "draw effect");
    case "tutors":
      return countPhrase(signals.tutors, "nonland tutor");
    case "roleOverlap":
      if (signals.roleOverlap === 0) return "No role shows up often";
      return signals.roleOverlap === 1
        ? `1 role shows up at least ${ROLE_REPEAT_PER_HUNDRED} times per 100 cards`
        : `${signals.roleOverlap} roles show up at least ${ROLE_REPEAT_PER_HUNDRED} times per 100 cards`;
    case "earlyThreats":
      return countPhrase(signals.earlyThreats, "early threat");
    case "suddenEndings":
      return signals.suddenEndings === 0
        ? "No extra turn, game-win, or two-card combo"
        : countPhrase(signals.suddenEndings, "sudden ending");
    case "nonlandCurve":
      return signals.averageManaValue === null
        ? "No nonland cards"
        : `Average mana value ${signals.averageManaValue.toFixed(2)}`;
    case "targetedAnswers":
      return countPhrase(signals.targetedAnswers, "targeted answer");
    case "boardSweeps":
      return countPhrase(signals.boardSweeps, "board sweep");
    case "manaDenial":
      return signals.manaDenial === 0 ? "No mass land denial" : countPhrase(signals.manaDenial, "mana-denial card");
    case "shields":
      return countPhrase(signals.shields, "shield");
    case "graveyardReturn":
      return countPhrase(signals.graveyardReturn, "graveyard return");
    case "standaloneThreats":
      return countPhrase(signals.standaloneThreats, "standalone threat");
    default:
      return "";
  }
}

function scoreBenchmarks(signals: BreakdownSignals): BenchmarkScore[] {
  return BENCHMARKS.map((benchmark) => {
    const value = benchmarkValue(benchmark.id, signals);
    const tier = scoreTier(benchmark, value);
    return {
      id: benchmark.id,
      group: benchmark.group,
      label: benchmark.label,
      letter: tier.letter,
      points: tier.points,
      reading: readingFor(benchmark.id, signals),
      value,
    };
  });
}

function bracketFor(signals: BreakdownSignals, format: string): BracketRead | null {
  if (format !== "commander") return null;
  const reasons: string[] = [];
  let floor: 2 | 3 | 4 = 2;

  if (signals.manaDenial > 0) {
    floor = 4;
    reasons.push(
      `${countPhrase(signals.manaDenial, "mass-land-denial card")} ${signals.manaDenial === 1 ? "is" : "are"} in the list. The published rules keep that out of Brackets 1–3.`,
    );
  }
  const early = signals.combos.filter((combo) => combo.early);
  const late = signals.combos.filter((combo) => !combo.early);
  if (early.length > 0) {
    floor = 4;
    const pair = early[0]!;
    reasons.push(
      `A two-card combo with both halves at mana value ${EARLY_COMBO_MANA_VALUE} or less is in the list (${pair.a} and ${pair.b}). Brackets 1–3 are not the place for that.`,
    );
  }
  if (signals.extraTurns >= EXTRA_TURNS_BEFORE_CHAINING) {
    floor = 4;
    reasons.push(
      `${signals.extraTurns} extra-turn cards. Brackets 2 and 3 expect these not to be chained.`,
    );
  }
  if (signals.gameChangers > GAME_CHANGERS_IN_UPGRADED) {
    floor = 4;
    reasons.push(`${signals.gameChangers} Game Changers. Bracket 3 allows up to three.`);
  } else if (signals.gameChangers > 0) {
    if (floor === 2) floor = 3;
    reasons.push(
      `${countPhrase(signals.gameChangers, "Game Changer")}. Brackets 1 and 2 allow none, and Bracket 3 allows up to three.`,
    );
  }
  if (late.length > 0) {
    if (floor === 2) floor = 3;
    const pair = late[0]!;
    reasons.push(
      `A two-card combo is in the list (${pair.a} and ${pair.b}). Brackets 1 and 2 allow none. Both halves cost more than ${EARLY_COMBO_MANA_VALUE}, so this read does not treat it as an early combo.`,
    );
  }
  if (floor === 2 && signals.extraTurns > 0 && signals.extraTurns < EXTRA_TURNS_BEFORE_CHAINING) {
    reasons.push(
      `${countPhrase(signals.extraTurns, "extra-turn card")}. A low number stays inside Bracket 2, which still asks that they not be chained.`,
    );
  }
  if (reasons.length === 0) {
    reasons.push(
      "No Game Changers, mass land denial, extra-turn cards, or two-card combos showed up. Bracket 1 is about intent, so the card floor is Bracket 2.",
    );
  }
  if (floor === 4) {
    reasons.push("Bracket 5 uses this same card pool with tournament intent, which a list cannot show.");
  }

  const summary =
    floor === 2
      ? "Card rules put this at Bracket 2 (Core). Bracket 1 is about intent, which a list cannot show."
      : floor === 3
        ? "Card rules put this at Bracket 3 (Upgraded)."
        : "Card rules put this at Bracket 4 (Optimized). Bracket 5 is the same card pool with tournament intent, which a list cannot show.";

  return { value: floor, name: BRACKET_NAMES[floor], summary, reasons };
}

function archetypeFor(signals: BreakdownSignals): string {
  const size = Math.max(signals.counted, 1);
  const per = (count: number) => perHundred(count, size);
  if (signals.combos.length > 0) return "Combo";
  if (signals.manaDenial >= 2) return "Denial";
  if (per(signals.counters) >= 8 && per(signals.boardSweeps) >= 2 && per(signals.earlyThreats) < 8) return "Control";
  if (per(signals.graveyardReturn) >= 6) return "Graveyard";
  if (per(signals.shields) >= 4 && per(signals.aurasAndEquipment) >= 4) return "Voltron";
  if (per(signals.tokenMakers) >= 6) return "Tokens";
  if (signals.instantsAndSorceries > signals.creatures && signals.instantsAndSorceries > 0) return "Spells";
  if (
    signals.averageManaValue !== null &&
    signals.averageManaValue <= 2.7 &&
    per(signals.earlyThreats) >= 14
  ) {
    return "Aggro";
  }
  if (
    per(signals.manaSpells) >= 14 &&
    signals.averageManaValue !== null &&
    signals.averageManaValue >= 3.5
  ) {
    return "Big mana";
  }
  return "Midrange";
}

interface ManaPiece {
  manaValue: number;
  mana: number;
}

/**
 * Land drops plus rocks and land-search spells. A rock adds mana starting
 * the turn after it could be cast, and only one new mana spell is cast
 * per turn. Rituals are skipped. Each land is one mana.
 */
export function manaByTurn(lands: number, pieces: readonly ManaPiece[], turns = 12): number[] {
  const waiting = [...pieces].sort((a, b) => a.manaValue - b.manaValue || b.mana - a.mana);
  const deployed: ManaPiece[] = [];
  const mana: number[] = [];
  for (let turn = 1; turn <= turns; turn += 1) {
    const available =
      Math.min(turn, Math.max(0, lands)) + deployed.reduce((sum, piece) => sum + piece.mana, 0);
    mana.push(available);
    const index = waiting.findIndex((piece) => piece.manaValue <= available);
    if (index >= 0) deployed.push(waiting.splice(index, 1)[0]!);
  }
  return mana;
}

function firstTurnAt(mana: readonly number[], needed: number): number | null {
  const index = mana.findIndex((amount) => amount >= needed);
  return index === -1 ? null : index + 1;
}

function rampPieces(cards: readonly ClassifiedCard[]): ManaPiece[] {
  const pieces: ManaPiece[] = [];
  for (const card of cards) {
    if (card.persistentMana <= 0) continue;
    for (let copy = 0; copy < card.quantity; copy += 1) {
      pieces.push({ manaValue: card.manaValue, mana: card.persistentMana });
    }
  }
  return pieces;
}

function cheapest<T>(cards: readonly T[], mana: (card: T) => number): T | null {
  let best: T | null = null;
  for (const card of cards) {
    if (!best || mana(card) < mana(best)) best = card;
  }
  return best;
}

function keyCards(cards: readonly ClassifiedCard[], commanderName: string | null, signals: BreakdownSignals) {
  const commander = commanderName
    ? cards.find((card) => normalizeCardName(card.cardName) === normalizeCardName(commanderName))
    : undefined;
  const comboNames = new Map<string, string>();
  for (const combo of signals.combos) {
    comboNames.set(normalizeCardName(combo.a), combo.b);
    comboNames.set(normalizeCardName(combo.b), combo.a);
  }
  const candidates: { cardName: string; role: string; priority: number }[] = [];
  if (commander) {
    const partner = comboNames.get(normalizeCardName(commander.cardName));
    const changer = commander.gameChanger ? " Game Changer, so it counts toward the bracket floor." : "";
    const pair = partner ? ` Pairs with ${partner} as a two-card combo.` : "";
    candidates.push({
      cardName: commander.cardName,
      role: `Commander, mana value ${commander.manaValue}.${changer}${pair}`,
      priority: 0,
    });
  }
  for (const card of uniqueNames(cards, (item) => item.gameChanger)) {
    if (commander && normalizeCardName(card.cardName) === normalizeCardName(commander.cardName)) continue;
    candidates.push({
      cardName: card.cardName,
      role: "Game Changer. It counts toward the bracket floor.",
      priority: 1,
    });
  }
  for (const combo of signals.combos) {
    for (const name of [combo.a, combo.b]) {
      const card = cards.find((item) => normalizeCardName(item.cardName) === normalizeCardName(name));
      if (!card) continue;
      const other = name === combo.a ? combo.b : combo.a;
      candidates.push({
        cardName: card.cardName,
        role: `Pairs with ${other} as a two-card combo.`,
        priority: 2,
      });
    }
  }
  const rocks = cards
    .filter((card) => card.ramp !== null)
    .sort((a, b) => b.persistentMana - a.persistentMana || a.manaValue - b.manaValue || a.cardName.localeCompare(b.cardName));
  const bestRamp = rocks[0];
  if (bestRamp) {
    const mana = bestRamp.persistentMana > 1 ? `, about ${bestRamp.persistentMana} mana` : "";
    candidates.push({ cardName: bestRamp.cardName, role: `Mana spell${mana}.`, priority: 3 });
  }
  const drawPool = cards.filter((card) => card.draw && !card.land);
  const draws = [...(drawPool.length > 0 ? drawPool : cards.filter((card) => card.draw))].sort((a, b) => {
    const rank = (card: ClassifiedCard) => (card.instantOrSorcery ? 1 : 0);
    return rank(a) - rank(b) || a.cardName.localeCompare(b.cardName);
  });
  if (draws[0]) candidates.push({ cardName: draws[0].cardName, role: "Draw effect.", priority: 4 });
  const sweep = [...cards.filter((card) => card.sweep)].sort((a, b) => a.cardName.localeCompare(b.cardName))[0];
  if (sweep) candidates.push({ cardName: sweep.cardName, role: "Board sweep.", priority: 5 });
  const shield = [...cards.filter((card) => card.shield)].sort((a, b) => a.cardName.localeCompare(b.cardName))[0];
  if (shield) candidates.push({ cardName: shield.cardName, role: "Shields a permanent.", priority: 6 });
  const extra = [...cards.filter((card) => card.extraTurn)].sort((a, b) => a.cardName.localeCompare(b.cardName))[0];
  if (extra) candidates.push({ cardName: extra.cardName, role: "Takes an extra turn.", priority: 7 });
  const late = [...cards.filter((card) => card.creature && !card.land && card.manaValue >= 6)].sort(
    (a, b) => b.manaValue - a.manaValue || a.cardName.localeCompare(b.cardName),
  )[0];
  if (late) {
    candidates.push({
      cardName: late.cardName,
      role: `Late creature, mana value ${late.manaValue}.`,
      priority: 8,
    });
  }
  return keyCardLines(candidates);
}

function emptyBreakdown(counted: number): DeckBreakdown {
  return {
    status: "insufficient",
    counted,
    minimum: MIN_COUNTED_CARDS,
    emptyMessage: `Not enough cards to read this list. The breakdown starts at ${MIN_COUNTED_CARDS} cards on the mainboard, and the commander counts. This list has ${counted}. Sideboard and maybeboard cards are left out.`,
    overview: null,
    primer: null,
    weaknesses: null,
    keyCards: [],
    score: null,
    maxScore: LIST_WEIGHT_MAX,
    bracket: null,
    archetype: null,
    speed: null,
    benchmarks: [],
    signals: null,
  };
}

export function analyzeDeck(input: BreakdownInput): DeckBreakdown {
  const cards = classifyDeck(input);
  const counted = sumQuantity(cards, () => true);
  if (counted < MIN_COUNTED_CARDS) return emptyBreakdown(counted);

  const signals = signalsFrom(cards);
  const benchmarks = scoreBenchmarks(signals);
  const score = benchmarks.reduce((sum, row) => sum + row.points, 0);
  const bracket = bracketFor(signals, input.format);
  const archetype = archetypeFor(signals);
  const commander = input.commander;
  const commanderCard = commander
    ? cards.find((card) => normalizeCardName(card.cardName) === normalizeCardName(commander.cardName))
    : undefined;
  const mana = manaByTurn(signals.lands, rampPieces(cards));
  const engineTurn = commanderCard
    ? firstTurnAt(mana, commanderCard.manaValue)
    : signals.averageManaValue === null
      ? null
      : firstTurnAt(mana, Math.max(1, Math.round(signals.averageManaValue)));
  const threat = cheapest(
    cards.filter((card) => card.earlyThreat),
    (card) => card.manaValue,
  );
  const threatTurn = threat ? firstTurnAt(mana, threat.manaValue) : null;
  const rampSorted = [...cards.filter((card) => card.ramp !== null)].sort(
    (a, b) => b.persistentMana - a.persistentMana || a.manaValue - b.manaValue || a.cardName.localeCompare(b.cardName),
  );

  const facts: ProseFacts = {
    name: input.name?.trim() ? input.name.trim() : null,
    formatLabel: input.formatLabel,
    isPrecon: Boolean(input.isPrecon),
    colors: input.colors === undefined ? null : input.colors,
    commanderName: commanderCard?.cardName ?? null,
    commanderManaValue: commanderCard?.manaValue ?? null,
    archetype,
    score,
    bracketSummary: bracket?.summary ?? null,
    signals,
    engineTurn,
    threatTurn,
    threatManaValue: threat?.manaValue ?? null,
    rampNames: rampSorted.map((card) => card.cardName),
    drawNames: namesWhere(cards, (card) => card.draw),
    shieldNames: namesWhere(cards, (card) => card.shield),
    lateNames: [...cards.filter((card) => card.creature && card.manaValue >= 6)]
      .sort((a, b) => b.manaValue - a.manaValue || a.cardName.localeCompare(b.cardName))
      .map((card) => card.cardName),
  };

  return {
    status: "ready",
    counted,
    minimum: MIN_COUNTED_CARDS,
    emptyMessage: null,
    overview: overviewParagraph(facts),
    primer: primerFrom(facts),
    weaknesses: weaknessesFrom(facts),
    keyCards: keyCards(cards, commanderCard?.cardName ?? null, signals),
    score,
    maxScore: LIST_WEIGHT_MAX,
    bracket,
    archetype,
    speed: speedLine(facts),
    benchmarks,
    signals,
  };
}
