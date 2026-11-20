/**
 * Deck breakdown: a deterministic read of a list the viewer can already see.
 * No I/O. The deck page passes stored cards (name, type line, mana cost,
 * oracle text, quantity, board) and the commander slot.
 */

export const LETTERS = ["S", "A", "B", "C", "D", "F"] as const;
export type Letter = (typeof LETTERS)[number];

export const BENCHMARK_GROUP_IDS = [
  "resources",
  "access",
  "pressure",
  "interaction",
  "resilience",
] as const;
export type BenchmarkGroup = (typeof BENCHMARK_GROUP_IDS)[number];

export interface BreakdownCard {
  cardName: string;
  typeLine: string;
  manaCost?: string | null;
  oracleText?: string | null;
  quantity: number;
  /** Missing means mainboard, matching deck rows saved before boards existed. */
  board?: string | null;
}

export interface BreakdownInput {
  /** Deck name, used in the overview. Omitted when the caller has none. */
  name?: string | null;
  /** Deck.format value. Only "commander" receives a bracket. */
  format: string;
  /** Display label, for example "Commander". */
  formatLabel: string;
  isPrecon?: boolean;
  /**
   * Deck colors in WUBRG order. null means the deck has no colors chosen.
   * [] is a colorless deck.
   */
  colors?: readonly string[] | null;
  commander?: BreakdownCard | null;
  cards: readonly BreakdownCard[];
}

export interface BenchmarkScore {
  id: string;
  group: BenchmarkGroup;
  label: string;
  letter: Letter;
  points: number;
  /** Short reading of the measured cards, for the row subtitle. */
  reading: string;
  /**
   * The number the tier table compared. Per-100 benchmarks use the scaled
   * count. Curve uses average mana value. Null when a curve has no spells.
   */
  value: number | null;
}

export interface ComboHit {
  a: string;
  b: string;
  /** Both halves are mana value 4 or less, so the pair can be cast early. */
  early: boolean;
}

export interface BreakdownSignals {
  counted: number;
  lands: number;
  manaSpells: number;
  cardDraw: number;
  tutors: number;
  earlyThreats: number;
  /** Extra-turn cards, plus two-card combos, plus other "you win the game" cards. */
  suddenEndings: number;
  targetedAnswers: number;
  boardSweeps: number;
  manaDenial: number;
  shields: number;
  graveyardReturn: number;
  standaloneThreats: number;
  gameChangers: number;
  gameChangerNames: string[];
  extraTurns: number;
  combos: ComboHit[];
  /** Null when the list has no nonland cards. */
  averageManaValue: number | null;
  /** How many tracked roles show up at least ROLE_REPEAT_PER_HUNDRED times per 100 cards. */
  roleOverlap: number;
  counters: number;
  tokenMakers: number;
  aurasAndEquipment: number;
  instantsAndSorceries: number;
  creatures: number;
}

export interface BracketRead {
  /** Card-rule floor. Bracket 1 and Bracket 5 are intent, so they are not assigned. */
  value: 2 | 3 | 4;
  name: string;
  /** One sentence for the overview. */
  summary: string;
  reasons: string[];
}

export interface Primer {
  steps: string[];
  keep: string;
  avoid: string;
  tips: string[];
}

export interface WeaknessBands {
  critical: string[];
  moderate: string[];
  minor: string[];
}

export interface KeyCard {
  cardName: string;
  role: string;
}

export interface DeckBreakdown {
  /** "skipped" means the list is over BREAKDOWN_MAX_CARDS and was not read. */
  status: "ready" | "insufficient" | "skipped";
  counted: number;
  minimum: number;
  emptyMessage: string | null;
  overview: string | null;
  primer: Primer | null;
  weaknesses: WeaknessBands | null;
  keyCards: KeyCard[];
  /** Sum of benchmark points. Null when there are not enough cards. */
  score: number | null;
  maxScore: number;
  bracket: BracketRead | null;
  archetype: string | null;
  /** If-left-alone speed line. Null when there are not enough cards. */
  speed: string | null;
  benchmarks: BenchmarkScore[];
  signals: BreakdownSignals | null;
}
