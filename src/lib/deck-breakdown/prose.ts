import type { BreakdownSignals, ComboHit, KeyCard, Primer, WeaknessBands } from "@/lib/deck-breakdown/types";

const COLOR_NAME: Record<string, string> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

export interface ProseFacts {
  name: string | null;
  formatLabel: string;
  isPrecon: boolean;
  colors: readonly string[] | null;
  commanderName: string | null;
  commanderManaValue: number | null;
  archetype: string;
  score: number;
  bracketSummary: string | null;
  signals: BreakdownSignals;
  engineTurn: number | null;
  threatTurn: number | null;
  threatManaValue: number | null;
  rampNames: string[];
  drawNames: string[];
  shieldNames: string[];
  lateNames: string[];
}

function countPhrase(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function colorPhrase(colors: readonly string[] | null): string {
  if (colors === null || colors === undefined) return "a";
  if (colors.length === 0) return "a colorless";
  if (colors.length === 1) {
    const name = COLOR_NAME[colors[0]!.toUpperCase()] ?? "one-color";
    return `a mono-${name}`;
  }
  if (colors.length >= 5) return "a five-color";
  if (colors.length === 4) return "a four-color";
  const names = colors.map((color) => COLOR_NAME[color.toUpperCase()] ?? color.toLowerCase());
  if (names.length === 2) return `a ${names[0]} and ${names[1]}`;
  return `a ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function joinNames(names: readonly string[], limit = 3): string {
  const shown = names.slice(0, limit);
  if (shown.length === 0) return "";
  if (shown.length === 1) return shown[0]!;
  if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
  return `${shown.slice(0, -1).join(", ")}, and ${shown[shown.length - 1]}`;
}

export function overviewParagraph(facts: ProseFacts): string {
  const lead = facts.name ? `${facts.name} is` : "This is";
  const led = facts.commanderName ? ` led by ${facts.commanderName}` : "";
  const precon = facts.isPrecon
    ? " It is an official precon. That label does not set the bracket."
    : "";
  const signals = facts.signals;
  const stats = `The rules read it as ${facts.archetype.toLowerCase()}: ${countPhrase(signals.lands, "land")}, ${countPhrase(signals.manaSpells, "mana spell")}, ${countPhrase(signals.cardDraw, "draw effect")}, and ${countPhrase(signals.targetedAnswers, "targeted answer")}.`;
  const weight = `List weight is ${facts.score}.`;
  const bracket =
    facts.bracketSummary ?? "Commander brackets are a Commander tool, so none is assigned here.";
  return `${lead} ${colorPhrase(facts.colors)} ${facts.formatLabel} deck${led}.${precon} ${stats} ${weight} ${bracket}`;
}

export function speedLine(facts: ProseFacts): string {
  const parts: string[] = [];
  if (facts.commanderName) {
    if (facts.engineTurn) {
      parts.push(
        `If the table leaves this list alone, ${facts.commanderName} can be cast around turn ${facts.engineTurn}.`,
      );
    } else {
      parts.push(
        `If the table leaves this list alone, the mana shown here may still not cast ${facts.commanderName}.`,
      );
    }
    if (
      facts.threatTurn &&
      facts.threatManaValue !== null &&
      facts.commanderManaValue !== null &&
      facts.threatManaValue < facts.commanderManaValue
    ) {
      parts.push(`A cheaper threat can land around turn ${facts.threatTurn}.`);
    }
  } else if (facts.signals.averageManaValue !== null && facts.engineTurn) {
    parts.push(
      `If the table leaves this list alone, a typical nonland spell (mana value ${facts.signals.averageManaValue.toFixed(2)}) can be cast around turn ${facts.engineTurn}.`,
    );
  } else {
    parts.push("There is not enough mana information to sketch a speed line.");
  }
  const early = facts.signals.combos.find((combo) => combo.early);
  if (early) {
    parts.push(
      `${early.a} and ${early.b} are both mana value 4 or less, so that pair can be assembled once both are drawn.`,
    );
  }
  parts.push(
    "Lands count as one mana. Mana rocks and land search count from the turn after they could be cast. Rituals are not in this line.",
  );
  return parts.join(" ");
}

function planStep(facts: ProseFacts): string {
  const signals = facts.signals;
  switch (facts.archetype) {
    case "Combo": {
      const combo = signals.combos[0];
      return combo
        ? `The list contains ${combo.a} and ${combo.b}. Draw both before committing to that line. These rules cannot see whether you will.`
        : "Look for a two-card combo in the list.";
    }
    case "Denial":
      return "Mana denial is part of the plan. Expect the table to treat those cards as the problem.";
    case "Control":
      return `Hold answers. This list has ${countPhrase(signals.targetedAnswers, "targeted answer")} and ${countPhrase(signals.boardSweeps, "board sweep")}.`;
    case "Graveyard":
      return `Fill the graveyard and reuse it. ${countPhrase(signals.graveyardReturn, "card")} can return something from it.`;
    case "Voltron":
      return `Suit up the commander. ${countPhrase(signals.shields, "card")} can shield a permanent.`;
    case "Tokens":
      return "Make tokens and turn them sideways.";
    case "Spells":
      return "Cast instants and sorceries. Creatures are the smaller share of the nonland cards.";
    case "Aggro":
      return "Play the cheaper creatures and attack.";
    case "Big mana":
      return `Accelerate, then cast the expensive spells. Nonland mana value averages ${signals.averageManaValue?.toFixed(2) ?? "high"}.`;
    default:
      return "Trade resources, then land a threat that can stay in play.";
  }
}

export function primerFrom(facts: ProseFacts): Primer {
  const signals = facts.signals;
  const ramp = joinNames(facts.rampNames, 2);
  const steps = [
    `Make land drops. This list has ${countPhrase(signals.lands, "land")} and ${countPhrase(signals.manaSpells, "mana spell")}${ramp ? `, including ${ramp}` : ""}.`,
  ];
  if (facts.commanderName && facts.commanderManaValue !== null) {
    const when = facts.engineTurn ? ` The rough read says turn ${facts.engineTurn} if those mana spells are drawn.` : "";
    steps.push(
      `Cast ${facts.commanderName} (mana value ${facts.commanderManaValue}) once the mana is there.${when}`,
    );
  } else if (facts.signals.averageManaValue !== null) {
    steps.push(
      `Spend the early turns on spells you can cast. Nonland cards average mana value ${facts.signals.averageManaValue.toFixed(2)}.`,
    );
  }
  steps.push(planStep(facts));
  const late = joinNames(facts.lateNames, 2);
  if (late) steps.push(`If the game runs long, the heavier creatures include ${late}.`);

  let keep =
    "Hands with 3 or 4 lands and either a mana spell or a spell you can cast by turn three.";
  if (signals.manaSpells * 100 >= 14 * Math.max(signals.counted, 1)) {
    keep = `${keep} A mana spell you can cast is worth more than another expensive threat.`;
  }
  let avoid = "Hands with one land or none, and hands that are only spells of mana value 5 or more.";
  if (signals.counted > 0 && (signals.lands * 100) / signals.counted < 34) {
    avoid = `${avoid} The land count is light, so a two-land hand is shakier than it looks.`;
  }

  const tips: string[] = [];
  if (signals.gameChangerNames.length > 0) {
    tips.push(
      `Includes ${joinNames(signals.gameChangerNames, 3)} from the Commander Game Changers list. That count is what sets the bracket floor.`,
    );
  }
  const combo: ComboHit | undefined = signals.combos[0];
  if (combo) {
    tips.push(
      `Both halves of a two-card combo are present (${combo.a} and ${combo.b}). These rules cannot tell whether you plan to assemble it.`,
    );
  }
  if (facts.commanderName && signals.shields > 0 && facts.shieldNames.length > 0) {
    tips.push(`Shields in the list include ${joinNames(facts.shieldNames, 2)}. They matter most on the commander.`);
  }
  if (signals.counted > 0 && (signals.targetedAnswers * 100) / signals.counted < 4 && signals.boardSweeps === 0) {
    tips.push("Targeted answers are scarce. A permanent the table needs gone may stay.");
  }
  if (signals.extraTurns > 0) {
    tips.push(
      `${countPhrase(signals.extraTurns, "card")} ${signals.extraTurns === 1 ? "takes" : "take"} an extra turn. A low number stays in a lower bracket. A pile of them does not.`,
    );
  }
  return { steps, keep, avoid, tips: tips.slice(0, 3) };
}

export function weaknessesFrom(facts: ProseFacts): WeaknessBands {
  const signals = facts.signals;
  const size = Math.max(signals.counted, 1);
  const per = (count: number) => (count * 100) / size;
  const critical: string[] = [];
  const moderate: string[] = [];
  const minor: string[] = [];

  if (per(signals.targetedAnswers) < 4 && per(signals.boardSweeps) < 1) {
    critical.push("Targeted answers are scarce, and there is no board sweep.");
  }
  if (per(signals.cardDraw) < 3) {
    critical.push("Card draw is nearly absent, so the opening hand has to carry the game.");
  }
  if (per(signals.lands) < 30) {
    critical.push("Lands are below 30 per 100 cards, which is thin next to these spell costs.");
  }
  if (
    facts.commanderName &&
    facts.commanderManaValue !== null &&
    facts.commanderManaValue >= 6 &&
    per(signals.manaSpells) < 8
  ) {
    critical.push(
      `${facts.commanderName} costs ${facts.commanderManaValue} and mana spells are thin, so the commander may stay in the command zone.`,
    );
  }

  if (signals.averageManaValue !== null && signals.averageManaValue >= 4) {
    moderate.push(
      `Nonland mana values average ${signals.averageManaValue.toFixed(2)}, so a missed mana spell slows the early turns.`,
    );
  }
  if (signals.boardSweeps === 0 && per(signals.targetedAnswers) >= 4) {
    moderate.push("There is no board sweep. A wide board has to be answered one permanent at a time.");
  }
  if (facts.colors && facts.colors.length === 0) {
    moderate.push("A colorless list has a narrow set of answers.");
  } else if (facts.colors && facts.colors.length === 1) {
    moderate.push("One color narrows the answers this list can play.");
  }
  if (signals.combos.length > 0 && per(signals.tutors) < 2) {
    moderate.push("The combo is not backed by tutors, so the list has to draw both pieces.");
  }

  if (per(signals.graveyardReturn) < 1) {
    minor.push("Nothing returns a card from the graveyard.");
  }
  if (facts.commanderName && per(signals.shields) < 1) {
    minor.push("No card grants hexproof, shroud, indestructible, or protection.");
  }
  return { critical, moderate, minor };
}

export function keyCardLines(
  cards: readonly {
    cardName: string;
    role: string;
    priority: number;
  }[],
): KeyCard[] {
  const sorted = [...cards].sort(
    (left, right) => left.priority - right.priority || left.cardName.localeCompare(right.cardName),
  );
  const seen = new Set<string>();
  const lines: KeyCard[] = [];
  for (const card of sorted) {
    const key = card.cardName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ cardName: card.cardName, role: card.role });
    if (lines.length >= 8) break;
  }
  return lines;
}
