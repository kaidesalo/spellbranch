export { analyzeDeck, breakdownRowCount, manaByTurn } from "@/lib/deck-breakdown/analyze";
export { classifyCard, classifyDeck, isCardDraw, isLandOnlySearch } from "@/lib/deck-breakdown/detect";
export {
  BENCHMARKS,
  BENCHMARK_GROUPS,
  BRACKET_NAMES,
  GAME_CHANGER_NAMES,
  BREAKDOWN_MAX_CARDS,
  LIST_WEIGHT_MAX,
  MIN_COUNTED_CARDS,
  isGameChangerName,
} from "@/lib/deck-breakdown/rules";
export type {
  BenchmarkScore,
  BracketRead,
  BreakdownCard,
  BreakdownInput,
  BreakdownSignals,
  DeckBreakdown,
  KeyCard,
  Letter,
} from "@/lib/deck-breakdown/types";
