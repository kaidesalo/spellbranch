import { getPrimaryType } from "@/lib/card-types";
import { LIMITS } from "@/lib/data/limits";
import { isMainBoard } from "@/lib/deck-boards";
import { manaValueOfCost } from "@/lib/deck-stats";
import {
  EARLY_COMBO_MANA_VALUE,
  TWO_CARD_COMBOS,
  cardNameKeys,
  isGameChangerName,
  isMassLandDenialName,
  normalizeCardName,
} from "@/lib/deck-breakdown/rules";
import type { BreakdownCard, BreakdownInput, ComboHit } from "@/lib/deck-breakdown/types";

export type RampKind = "rock" | "landSearch" | "ritual";

export interface ClassifiedCard {
  cardName: string;
  quantity: number;
  manaValue: number;
  primary: ReturnType<typeof getPrimaryType>;
  land: boolean;
  ramp: RampKind | null;
  /** Mana a rock or land-search spell still provides on later turns. Rituals are 0. */
  persistentMana: number;
  draw: boolean;
  tutor: boolean;
  targeted: boolean;
  sweep: boolean;
  shield: boolean;
  recursion: boolean;
  extraTurn: boolean;
  massLandDenial: boolean;
  gameChanger: boolean;
  earlyThreat: boolean;
  standalone: boolean;
  winsGame: boolean;
  tokenMaker: boolean;
  auraOrEquipment: boolean;
  instantOrSorcery: boolean;
  counter: boolean;
  creature: boolean;
}

/** Reminder text in parentheses is not rules text. */
export function rulesText(oracle: string | null | undefined): string {
  return (oracle ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function positiveQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.floor(quantity);
}

/**
 * Mainboard rows, plus the commander when that name is not already there.
 * Sideboard and maybeboard are dropped.
 */
export function cardsForBreakdown(input: Pick<BreakdownInput, "cards" | "commander">): BreakdownCard[] {
  const main = input.cards.filter((card) => isMainBoard(card.board) && positiveQuantity(card.quantity) > 0);
  const commander = input.commander;
  if (!commander || positiveQuantity(commander.quantity) <= 0) return main;
  const commanderKey = normalizeCardName(commander.cardName);
  const already = main.some((card) => normalizeCardName(card.cardName) === commanderKey);
  if (already) return main;
  return [...main, { ...commander, quantity: positiveQuantity(commander.quantity) || 1, board: "main" }];
}

function searchClause(text: string): string | null {
  const match = /search your library for ([^.,]*)/i.exec(text);
  return match ? match[1]!.trim() : null;
}

/** A library search that only finds lands (including basic land types). */
export function isLandOnlySearch(clause: string): boolean {
  const landish = /\b(plains|island|swamp|mountain|forest|wastes|lands?)\b/i.test(clause);
  if (!landish) return false;
  const cleaned = clause
    .replace(/\bbasic\s+land\s+cards?\b/gi, " ")
    .replace(/\bland\s+cards?\b/gi, " ")
    .replace(/\b(?:plains|island|swamp|mountain|forest|wastes)\s+cards?\b/gi, " ")
    .replace(/\b(?:plains|island|swamp|mountain|forest|wastes|lands?)\b/gi, " ");
  return !/\b(creature|instant|sorcery|artifact|enchantment|planeswalker|permanent|card)\b/i.test(cleaned);
}

function symbolCount(body: string): number {
  return body.match(/\{[^}]+\}/g)?.length ?? 0;
}

/** How much mana an "Add" effect produces. Sol Ring is 2. A signet is 1. */
const MANA_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

export function addedMana(text: string): number {
  const tapped = /\{T\}:\s*Add\s+((?:\{[^}]+\}\s*)+)/i.exec(text);
  if (tapped) return Math.max(1, symbolCount(tapped[1]!));
  const words = /\badd (one|two|three|four|five|six) mana\b/i.exec(text);
  if (words) return MANA_WORDS[words[1]!.toLowerCase()] ?? 1;
  const ritual = /\bAdd\s+((?:\{[^}]+\}\s*)+)/i.exec(text);
  if (ritual) return Math.max(1, symbolCount(ritual[1]!));
  return 1;
}

/**
 * A Treasure token that is the spell's mana, not a combat trick that happens
 * to leave one behind. "Create a Treasure" on a damage trigger or a pump
 * spell is not counted as a mana spell.
 */
function isTreasureMana(text: string): boolean {
  if (!/\bcreate\b[^.]{0,80}\bTreasure\b/i.test(text)) return false;
  return !/\b(gets? \+|additional combat|first strike|double strike|combat damage)\b/i.test(text);
}

function isNonlandTutor(text: string): boolean {
  const clause = searchClause(text);
  return clause !== null && !isLandOnlySearch(clause);
}

function rampOf(text: string, typeLine: string, land: boolean): { kind: RampKind; mana: number } | null {
  if (land) return null;
  const clause = searchClause(text);
  if (clause && isLandOnlySearch(clause)) {
    return { kind: "landSearch", mana: /up to two/i.test(clause) ? 2 : 1 };
  }
  if (/\{T\}:\s*Add\b/i.test(text)) return { kind: "rock", mana: addedMana(text) };
  if (isTreasureMana(text)) return { kind: "rock", mana: 1 };
  const spell = /\b(instant|sorcery)\b/i.test(typeLine);
  if (spell && /\bAdd\s+\{/i.test(text)) return { kind: "ritual", mana: addedMana(text) };
  return null;
}

/**
 * A draw effect, not a payoff that only triggers off drawing.
 * "Each opponent draws" is not this list's card draw.
 */
export function isCardDraw(text: string): boolean {
  const effect = /\bdraws?\s+(?:a|an|one|two|three|four|five|six|seven|x|\d+)(?:\s+additional)?\s+cards?\b/gi;
  for (const match of text.matchAll(effect)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 28), index);
    if (/\bwhenever\s+(?:you|a player|an opponent|each opponent)\s*$/i.test(before)) continue;
    if (/\bwhen\s+you\s*$/i.test(before)) continue;
    const sentenceStart = Math.max(text.lastIndexOf(".", index), text.lastIndexOf(";", index)) + 1;
    const sentenceEnd = text.indexOf(".", index);
    const sentence = text.slice(sentenceStart, sentenceEnd === -1 ? text.length : sentenceEnd);
    if (/\bopponents?\b/i.test(sentence) && !/\byou\b/i.test(sentence)) continue;
    return true;
  }
  if (
    /(?:exile|reveal) the top card of your library/i.test(text) &&
    /into your hand/i.test(text) &&
    !/search your library/i.test(text)
  ) {
    return true;
  }
  return false;
}

function isTargetedAnswer(text: string): boolean {
  // "Return target card from a graveyard to your hand" is recursion, not removal.
  const bounce =
    /\breturn target\b[^.]{0,50}\bhand\b/i.test(text) && !/\bgraveyard\b/i.test(text);
  return (
    /\bdestroy target\b/i.test(text) ||
    /\bexile target\b/i.test(text) ||
    bounce ||
    /\bdeals?\s+\d+\s+damage to (?:any target|target (?:creature|planeswalker|player|opponent))\b/i.test(text) ||
    /\btarget creature gets? -(?:\d+|x)\/-(?:\d+|x)/i.test(text) ||
    /\bfight target\b/i.test(text) ||
    /\bcounter target spell\b/i.test(text)
  );
}

function isSweep(text: string): boolean {
  if (
    /\bdestroy all (?:creatures|permanents|artifacts|enchantments|nonland)\b/i.test(text) ||
    /\bexile all (?:creatures|permanents|artifacts|enchantments|graveyards)\b/i.test(text) ||
    /\ball creatures get -(?:\d+|x)\/-(?:\d+|x)/i.test(text) ||
    /\bdamage to each (?:creature|opponent)\b/i.test(text) ||
    /\beach (?:opponent|player) sacrifices\b[^.]{0,40}\b(?:creature|permanent)/i.test(text)
  ) {
    return true;
  }
  // Overload turns "target" into "each". The reminder text was stripped.
  return /\boverload\b/i.test(text) && /\b(?:destroy|exile|return) target\b/i.test(text);
}

function isShield(text: string, land: boolean): boolean {
  if (land) return false;
  return /\b(hexproof|shroud|indestructible|protection from)\b/i.test(text);
}

function isRecursion(text: string): boolean {
  return (
    /\breturn\b[^.]{0,60}\bfrom (?:your |a |their )?graveyard\b/i.test(text) ||
    /\bfrom (?:your |a )?graveyard (?:to your hand|onto the battlefield|to the battlefield)\b/i.test(text) ||
    /\bput target\b[^.]{0,40}\bcard from a graveyard onto the battlefield\b/i.test(text)
  );
}

function oracleIsMassLandDenial(text: string): boolean {
  return (
    /\bdestroy all lands\b/i.test(text) ||
    /\bexile all lands\b/i.test(text) ||
    /\beach player sacrifices\b[^.]{0,40}\blands?\b/i.test(text) ||
    /\blands? (?:don't|do not) untap\b/i.test(text) ||
    /\bcan't untap more than one land\b/i.test(text) ||
    /\bnonbasic lands are\b/i.test(text) ||
    /\ball lands are\b/i.test(text)
  );
}

function keywordThreat(text: string): boolean {
  return /\b(flying|trample|menace|lifelink|haste)\b/i.test(text);
}

/** Stored cards are already capped. A longer string handed in is cut before any regex. */
function clip(value: string | null | undefined, max: number): string {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.length > max ? value.slice(0, max) : value;
}

export function classifyCard(card: BreakdownCard): ClassifiedCard {
  const quantity = positiveQuantity(card.quantity);
  const cardName = clip(card.cardName, LIMITS.cardName);
  const text = rulesText(clip(card.oracleText, LIMITS.oracleText));
  const typeLine = clip(card.typeLine, LIMITS.typeLine);
  const primary = getPrimaryType(typeLine);
  const land = primary === "Land";
  const rampInfo = rampOf(text, typeLine, land);
  const ramp = rampInfo?.kind ?? null;
  const creature = primary === "Creature";
  const planeswalker = primary === "Planeswalker";
  const manaValue = manaValueOfCost(clip(card.manaCost, LIMITS.manaCost));
  const earlyThreat =
    ramp === null &&
    (creature || planeswalker || primary === "Battle") &&
    manaValue <= 4;
  const standalone =
    ramp === null &&
    (planeswalker || (creature && keywordThreat(text))) &&
    manaValue <= 6;
  return {
    cardName,
    quantity,
    manaValue,
    primary,
    land,
    ramp,
    persistentMana: rampInfo && rampInfo.kind !== "ritual" ? rampInfo.mana : 0,
    draw: isCardDraw(text),
    tutor: isNonlandTutor(text),
    targeted: isTargetedAnswer(text),
    sweep: isSweep(text),
    shield: isShield(text, land),
    recursion: isRecursion(text),
    extraTurn: /\btakes? an extra turn\b/i.test(text),
    massLandDenial: isMassLandDenialName(cardName) || oracleIsMassLandDenial(text),
    gameChanger: isGameChangerName(cardName),
    earlyThreat,
    standalone,
    winsGame: /\byou win the game\b/i.test(text),
    tokenMaker: /\bcreate\b[^.]{0,60}\btoken/i.test(text),
    auraOrEquipment: /\bequipment\b/i.test(typeLine) || /\baura\b/i.test(typeLine),
    instantOrSorcery: primary === "Instant" || primary === "Sorcery",
    counter: /\bcounter target spell\b/i.test(text),
    creature,
  };
}

export function classifyDeck(input: Pick<BreakdownInput, "cards" | "commander">): ClassifiedCard[] {
  return cardsForBreakdown(input).map(classifyCard).filter((card) => card.quantity > 0);
}

export function sumQuantity(cards: readonly ClassifiedCard[], include: (card: ClassifiedCard) => boolean): number {
  let total = 0;
  for (const card of cards) {
    if (include(card)) total += card.quantity;
  }
  return total;
}

function namesMatch(left: string, right: string): boolean {
  const keys = new Set(cardNameKeys(left));
  return cardNameKeys(right).some((key) => keys.has(key));
}

function manaValueOfNamed(cards: readonly ClassifiedCard[], name: string): number | null {
  const found = cards.find((card) => namesMatch(card.cardName, name));
  return found ? found.manaValue : null;
}

/** Pairs from TWO_CARD_COMBOS where both halves are in the counted list. */
export function findCombos(cards: readonly ClassifiedCard[]): ComboHit[] {
  const hits: ComboHit[] = [];
  for (const [a, b] of TWO_CARD_COMBOS) {
    const manaA = manaValueOfNamed(cards, a);
    const manaB = manaValueOfNamed(cards, b);
    if (manaA === null || manaB === null) continue;
    hits.push({
      a,
      b,
      early: manaA <= EARLY_COMBO_MANA_VALUE && manaB <= EARLY_COMBO_MANA_VALUE,
    });
  }
  return hits;
}

export function perHundred(count: number, size: number): number {
  if (size <= 0) return 0;
  return (count * 100) / size;
}
