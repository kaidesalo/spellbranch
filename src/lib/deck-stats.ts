import { getPrimaryType } from "@/lib/card-types";
import { isMainBoard } from "@/lib/deck-boards";

/**
 * Deck statistics. Pure: the page passes mainboard rows (and the commander,
 * when it is not already one of those rows) plus whatever Scryfall returned
 * for those printings. Sideboard and maybeboard never reach the math.
 *
 * Mana value prefers Scryfall's cmc and falls back to the mana cost. Prices
 * prefer usd, and usd_foil only when the row is marked foil. Deck rows do
 * not record a finish, so the deck page leaves foil false.
 */

export const CURVE_LABELS = ["0", "1", "2", "3", "4", "5", "6", "7+"] as const;

export const PIP_COLORS = ["W", "U", "B", "R", "G", "C"] as const;
export type PipColor = (typeof PIP_COLORS)[number];

const PIP_SET = new Set<string>(PIP_COLORS);

export const TYPE_BREAKDOWN = [
  "Creature",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Land",
  "Battle",
] as const;

export interface DeckStatSource {
  cardName: string;
  scryfallId?: string | null;
  quantity: number;
  board?: string | null;
  manaCost: string | null;
  typeLine: string;
  colorIdentity?: readonly string[] | null;
  /** Scryfall cmc when the printing was fetched. Null uses the mana cost. */
  cmc?: number | null;
  producedMana?: readonly string[] | null;
  usd?: number | null;
  usdFoil?: number | null;
  foil?: boolean;
}

export interface CurveBucket {
  label: (typeof CURVE_LABELS)[number];
  count: number;
  creatures: number;
  other: number;
}

export interface ColorStat {
  color: PipColor;
  pips: number;
  /** Share of all pips, 0–100. */
  pipShare: number;
  sources: number;
  /** Share of all source counts, 0–100. */
  sourceShare: number;
}

export interface TypeStat {
  type: (typeof TYPE_BREAKDOWN)[number];
  count: number;
}

export interface DeckStats {
  /** Nonland cards only. Null when the deck has none. Includes the commander when it was passed in. */
  averageCmc: number | null;
  /** Nonland cards, quantity included. */
  spellCount: number;
  priceUsd: number | null;
  /** Mainboard rows (and the commander) with no usable price. */
  unpriced: number;
  curve: CurveBucket[];
  colors: ColorStat[];
  totalPips: number;
  totalSources: number;
  types: TypeStat[];
}

/** One card's colored and colorless pips. Hybrid symbols split evenly. */
export function pipsInCost(manaCost: string | null | undefined): Record<PipColor, number> {
  const pips = emptyPips();
  if (!manaCost) return pips;
  for (const body of symbolBodies(manaCost)) {
    for (const [color, share] of Object.entries(pipsInSymbol(body))) {
      pips[color as PipColor] += share;
    }
  }
  return pips;
}

/** Mana value of a cost. X, Y, and Z are 0. {2/W} is 2. {W/U} is 1. */
export function manaValueOfCost(manaCost: string | null | undefined): number {
  if (!manaCost) return 0;
  let total = 0;
  for (const body of symbolBodies(manaCost)) total += manaValueOfSymbol(body);
  return total;
}

export function unitPrice(source: Pick<DeckStatSource, "foil" | "usd" | "usdFoil">): number | null {
  if (source.foil) return finitePrice(source.usdFoil) ?? finitePrice(source.usd);
  return finitePrice(source.usd);
}

/**
 * Mainboard rows, plus the commander when it is not already in that list.
 * Sideboard and maybeboard are dropped. Quantity below 1 is dropped.
 */
export function sourcesForDeckStats(
  cards: readonly DeckStatSource[],
  commander: DeckStatSource | null,
): DeckStatSource[] {
  const main = cards.filter((card) => isMainBoard(card.board) && card.quantity > 0);
  if (!commander || commander.quantity <= 0) return main;
  const already =
    (commander.scryfallId &&
      main.some((card) => card.scryfallId && card.scryfallId === commander.scryfallId)) ||
    main.some((card) => card.cardName === commander.cardName);
  if (already) return main;
  return [...main, { ...commander, quantity: commander.quantity || 1, board: "main" }];
}

/**
 * `identity` null means "no colors chosen": use the cards' own color
 * identities. An empty array is a colorless deck, so only colorless sources count.
 */
export function computeDeckStats(
  sources: readonly DeckStatSource[],
  identity: readonly string[] | null,
): DeckStats {
  const curve = CURVE_LABELS.map((label) => ({ label, count: 0, creatures: 0, other: 0 }));
  const pips = emptyPips();
  const sourcesByColor = emptyPips();
  const typeCounts = new Map<TypeStat["type"], number>();
  let spellMana = 0;
  let spellCount = 0;
  let price = 0;
  let pricedQty = 0;
  let unpriced = 0;

  for (const source of sources) {
    const qty = source.quantity;
    if (qty <= 0) continue;
    const type = getPrimaryType(source.typeLine);
    if (TYPE_BREAKDOWN.includes(type as TypeStat["type"])) {
      const key = type as TypeStat["type"];
      typeCounts.set(key, (typeCounts.get(key) ?? 0) + qty);
    }
    const each = unitPrice(source);
    if (each === null) unpriced += qty;
    else {
      price += each * qty;
      pricedQty += qty;
    }

    const cost = pipsInCost(source.manaCost);
    for (const color of PIP_COLORS) pips[color] += cost[color] * qty;

    const allowed = sourceColors(identity, sources);
    const seen = new Set<PipColor>();
    for (const raw of source.producedMana ?? []) {
      const color = raw.toUpperCase();
      if (!PIP_SET.has(color) || !allowed.has(color as PipColor)) continue;
      const pip = color as PipColor;
      if (seen.has(pip)) continue;
      seen.add(pip);
      sourcesByColor[pip] += qty;
    }

    if (type === "Land") continue;
    const mv = source.cmc ?? manaValueOfCost(source.manaCost);
    const bucket = Math.min(7, Math.max(0, Math.floor(Number.isFinite(mv) ? mv : 0)));
    const row = curve[bucket]!;
    row.count += qty;
    if (type === "Creature") row.creatures += qty;
    else row.other += qty;
    spellMana += (Number.isFinite(mv) ? mv : 0) * qty;
    spellCount += qty;
  }

  const totalPips = PIP_COLORS.reduce((sum, color) => sum + pips[color], 0);
  const totalSources = PIP_COLORS.reduce((sum, color) => sum + sourcesByColor[color], 0);
  const colors = PIP_COLORS.filter((color) => pips[color] > 0 || sourcesByColor[color] > 0).map((color) => ({
    color,
    pips: pips[color],
    pipShare: share(pips[color], totalPips),
    sources: sourcesByColor[color],
    sourceShare: share(sourcesByColor[color], totalSources),
  }));

  return {
    averageCmc: spellCount > 0 ? spellMana / spellCount : null,
    spellCount,
    priceUsd: pricedQty > 0 ? price : null,
    unpriced,
    curve,
    colors,
    totalPips,
    totalSources,
    types: TYPE_BREAKDOWN.filter((type) => (typeCounts.get(type) ?? 0) > 0).map((type) => ({
      type,
      count: typeCounts.get(type) ?? 0,
    })),
  };
}

export function formatUsd(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "—";
  const fixed = (Math.round(amount * 100) / 100).toFixed(2);
  const [whole, cents] = fixed.split(".");
  const withCommas = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === "00" ? `$${withCommas}` : `$${withCommas}.${cents}`;
}

export function formatPips(amount: number): string {
  const rounded = Math.round(amount * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatAverage(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "—";
  return amount.toFixed(2);
}

/** Facts we keep from a Scryfall printing. Missing money stays null. */
export interface PrintingFacts {
  id: string;
  cmc: number | null;
  manaCost: string | null;
  producedMana: string[];
  usd: number | null;
  usdFoil: number | null;
}

export function printingFacts(card: {
  id: string;
  cmc?: number;
  mana_cost?: string;
  produced_mana?: string[];
  prices?: { usd?: string | null; usd_foil?: string | null };
  card_faces?: Array<{ mana_cost?: string; produced_mana?: string[] }>;
}): PrintingFacts {
  const manaCost = card.mana_cost?.trim()
    ? card.mana_cost
    : (card.card_faces?.map((face) => face.mana_cost).filter(Boolean).join("") ?? null);
  const produced = new Set<string>();
  for (const color of card.produced_mana ?? []) produced.add(color);
  for (const face of card.card_faces ?? []) {
    for (const color of face.produced_mana ?? []) produced.add(color);
  }
  return {
    id: card.id.toLowerCase(),
    cmc: typeof card.cmc === "number" && Number.isFinite(card.cmc) ? card.cmc : null,
    manaCost: manaCost || null,
    producedMana: [...produced],
    usd: money(card.prices?.usd),
    usdFoil: money(card.prices?.usd_foil),
  };
}

export function applyPrintingFacts(source: DeckStatSource, facts: PrintingFacts | undefined): DeckStatSource {
  if (!facts) return source;
  return {
    ...source,
    cmc: facts.cmc,
    manaCost: facts.manaCost ?? source.manaCost,
    producedMana: facts.producedMana,
    usd: facts.usd,
    usdFoil: facts.usdFoil,
  };
}

function sourceColors(identity: readonly string[] | null, sources: readonly DeckStatSource[]): Set<PipColor> {
  const letters = identity ?? sources.flatMap((source) => source.colorIdentity ?? []);
  const allowed = new Set<PipColor>(["C"]);
  for (const letter of letters) {
    const color = String(letter).toUpperCase();
    if (PIP_SET.has(color) && color !== "C") allowed.add(color as PipColor);
  }
  return allowed;
}

function share(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function emptyPips(): Record<PipColor, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function symbolBodies(manaCost: string): string[] {
  const bodies: string[] = [];
  for (const match of manaCost.matchAll(/\{([^}]+)\}/g)) bodies.push(match[1]!.toUpperCase());
  return bodies;
}

function pipsInSymbol(body: string): Partial<Record<PipColor, number>> {
  const parts = body.split("/");
  const colors = parts.filter((part): part is PipColor => PIP_SET.has(part));
  if (colors.length === 0) return {};
  const shareEach = 1 / colors.length;
  const out: Partial<Record<PipColor, number>> = {};
  for (const color of colors) out[color] = (out[color] ?? 0) + shareEach;
  return out;
}

function manaValueOfSymbol(body: string): number {
  const parts = body.split("/");
  if (parts.length === 1) {
    const part = parts[0]!;
    if (/^\d+$/.test(part)) return Number(part);
    if (part === "X" || part === "Y" || part === "Z") return 0;
    if (part === "H") return 0.5;
    if (PIP_SET.has(part) || part === "S") return 1;
    return 0;
  }
  const generic = parts.filter((part) => /^\d+$/.test(part)).map(Number);
  if (generic.length > 0) return Math.max(...generic);
  return 1;
}

function finitePrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function money(value: unknown): number | null {
  if (typeof value === "number") return finitePrice(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return finitePrice(parsed);
  }
  return null;
}
