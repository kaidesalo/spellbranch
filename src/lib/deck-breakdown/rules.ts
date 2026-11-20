import type { BenchmarkGroup, Letter } from "@/lib/deck-breakdown/types";

/**
 * Rule tables for the deck breakdown.
 *
 * List weight is the sum of the benchmark points below. The maximum is
 * LIST_WEIGHT_MAX (80). A higher total is a heavier list on paper. It is
 * not a win rate.
 *
 * Counts that scale with deck size are "per 100 cards" (mainboard quantity
 * plus the commander when it is not already in that list). Sideboard and
 * maybeboard are ignored. A few benchmarks are absolute, because one copy
 * changes the list no matter how large the deck is: sudden endings, mana
 * denial, and role overlap.
 *
 * Commander bracket is a separate card-rule floor, not a rescaling of list
 * weight. It follows the published Commander bracket rules as of the
 * 2026-02-09 beta update: Game Changers, mass land denial, extra turns, and
 * two-card combos. Bracket 1 (Exhibition) and Bracket 5 (cEDH) are about
 * intent, so this read never assigns them. Precons are not pinned to a
 * bracket (Wizards decoupled that).
 *
 * Game Changers: Scryfall `is:gamechanger` on 2026-11-20, which tracks the
 * Wizards list (53 cards, including Farewell and Biorhythm).
 * https://magic.wizards.com/en/formats/commander
 */

/** Below this many counted cards the panel shows the empty state. */
export const MIN_COUNTED_CARDS = 20;

/**
 * Most cards the breakdown will open. A normal Commander list is about 100
 * rows. The review probe of 5,000 rows with long oracle text took seconds
 * on the server render, which blocks the process, so anything past this
 * is skipped before a row is read or a detector runs.
 *
 * The count is `cards.length` plus one when a commander slot is passed.
 * It is not a quantity sum, and it does not look at names, boards, or
 * oracle text. 250 still analyzes. 251 skips.
 */
export const BREAKDOWN_MAX_CARDS = 250;

/** A role "repeats" at this many copies per 100 cards. */
export const ROLE_REPEAT_PER_HUNDRED = 6;

/** 1–2 extra-turn cards stay in Bracket 2. This many is chaining. */
export const EXTRA_TURNS_BEFORE_CHAINING = 3;

/** Bracket 3 allows up to this many Game Changers. One more is Bracket 4. */
export const GAME_CHANGERS_IN_UPGRADED = 3;

/**
 * A two-card combo is "early" when both halves are this mana value or less.
 * That is the stand-in for "can come together before turn six."
 */
export const EARLY_COMBO_MANA_VALUE = 4;

export const BRACKET_NAMES = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
} as const;

/**
 * English card names. Double-faced cards use Scryfall's combined name.
 * Matching also accepts either face on its own (see isGameChangerName).
 */
export const GAME_CHANGER_NAMES = [
  "Ad Nauseam",
  "Ancient Tomb",
  "Aura Shards",
  "Biorhythm",
  "Bolas's Citadel",
  "Braids, Cabal Minion",
  "Chrome Mox",
  "Coalition Victory",
  "Consecrated Sphinx",
  "Crop Rotation",
  "Cyclonic Rift",
  "Demonic Tutor",
  "Drannith Magistrate",
  "Enlightened Tutor",
  "Farewell",
  "Field of the Dead",
  "Fierce Guardianship",
  "Force of Will",
  "Gaea's Cradle",
  "Gamble",
  "Gifts Ungiven",
  "Glacial Chasm",
  "Grand Arbiter Augustin IV",
  "Grim Monolith",
  "Humility",
  "Imperial Seal",
  "Intuition",
  "Jeska's Will",
  "Lion's Eye Diamond",
  "Mana Vault",
  "Mishra's Workshop",
  "Mox Diamond",
  "Mystical Tutor",
  "Narset, Parter of Veils",
  "Natural Order",
  "Necropotence",
  "Notion Thief",
  "Opposition Agent",
  "Orcish Bowmasters",
  "Panoptic Mirror",
  "Rhystic Study",
  "Seedborn Muse",
  "Serra's Sanctum",
  "Smothering Tithe",
  "Survival of the Fittest",
  "Teferi's Protection",
  "Tergrid, God of Fright // Tergrid's Lantern",
  "Thassa's Oracle",
  "The One Ring",
  "The Tabernacle at Pendrell Vale",
  "Underworld Breach",
  "Vampiric Tutor",
  "Worldly Tutor",
] as const;

/**
 * Cards that mess with several lands at once, matching the published
 * description of mass land denial (destroy, exile, or keep lands from
 * untapping, without replacing them). Oracle patterns in detect.ts catch
 * the same effects when the name is not on this list. "Destroy target land"
 * is not mass land denial.
 */
export const MASS_LAND_DENIAL_NAMES = [
  "Armageddon",
  "Back to Basics",
  "Bend or Break",
  "Blood Moon",
  "Boom // Bust",
  "Burning of Xinye",
  "Cataclysm",
  "Cataclysmic Gearhulk",
  "Confounding Conundrum",
  "Contamination",
  "Decree of Annihilation",
  "Epicenter",
  "Fall of the Thran",
  "Global Ruin",
  "Hall of Gemstone",
  "Harbinger of the Seas",
  "Impending Disaster",
  "Jokulhaups",
  "Land Equilibrium",
  "Limited Resources",
  "Magus of the Moon",
  "Mana Breach",
  "Obliterate",
  "Ravages of War",
  "Realm Razer",
  "Rising Waters",
  "Ruination",
  "Stasis",
  "Static Orb",
  "Sunder",
  "Vorinclex, Voice of Hunger",
  "Wildfire",
  "Winter Orb",
] as const;

/**
 * Two-card combos the rules can see by name. Three-card combos are out of
 * scope. "Early" is decided from the mana values in the deck, not here.
 */
export const TWO_CARD_COMBOS: readonly (readonly [string, string])[] = [
  ["Thassa's Oracle", "Demonic Consultation"],
  ["Thassa's Oracle", "Tainted Pact"],
  ["Heliod, Sun-Crowned", "Walking Ballista"],
  ["Exquisite Blood", "Sanguine Bond"],
  ["Mikaeus, the Unhallowed", "Triskelion"],
  ["Kiki-Jiki, Mirror Breaker", "Zealous Conscripts"],
  ["Kiki-Jiki, Mirror Breaker", "Combat Celebrant"],
  ["Splinter Twin", "Deceiver Exarch"],
  ["Splinter Twin", "Pestermite"],
  ["Dramatic Reversal", "Isochron Scepter"],
  ["Niv-Mizzet, Parun", "Curiosity"],
  ["Niv-Mizzet, Parun", "Ophidian Eye"],
  ["Niv-Mizzet, Parun", "Tandem Lookout"],
  ["Painter's Servant", "Grindstone"],
  ["Dualcaster Mage", "Twinflame"],
  ["Dualcaster Mage", "Heat Shimmer"],
  ["Food Chain", "Eternal Scourge"],
  ["Food Chain", "Squee, the Immortal"],
  ["Worldgorger Dragon", "Animate Dead"],
  ["Peregrine Drake", "Deadeye Navigator"],
  ["Grim Monolith", "Power Artifact"],
  ["Basalt Monolith", "Rings of Brighthearth"],
];

export interface ScoreTier {
  letter: Exclude<Letter, "F">;
  points: number;
  /**
   * Higher-is-better benchmarks: inclusive minimum.
   * The curve benchmark: inclusive maximum average mana value.
   */
  at: number;
}

export interface BenchmarkDef {
  id: string;
  group: BenchmarkGroup;
  label: string;
  /**
   * per100: compare count * 100 / deck size.
   * absolute: compare the raw count.
   * curve: lower average mana value scores higher. `at` is a maximum.
   */
  scale: "per100" | "absolute" | "curve";
  /** Highest tier first for per100 and absolute. Lowest average first for curve. */
  tiers: readonly ScoreTier[];
}

export const BENCHMARK_GROUPS: readonly { id: BenchmarkGroup; label: string }[] = [
  { id: "resources", label: "Resources" },
  { id: "access", label: "Card access" },
  { id: "pressure", label: "Pressure" },
  { id: "interaction", label: "Interaction" },
  { id: "resilience", label: "Resilience" },
];

export const BENCHMARKS: readonly BenchmarkDef[] = [
  {
    id: "manaSpells",
    group: "resources",
    label: "Mana spells",
    scale: "per100",
    tiers: [
      { at: 18, letter: "S", points: 9 },
      { at: 14, letter: "A", points: 7 },
      { at: 10, letter: "B", points: 5 },
      { at: 7, letter: "C", points: 3 },
      { at: 4, letter: "D", points: 1 },
    ],
  },
  {
    id: "cardDraw",
    group: "resources",
    label: "Card draw",
    scale: "per100",
    tiers: [
      { at: 16, letter: "S", points: 8 },
      { at: 12, letter: "A", points: 6 },
      { at: 8, letter: "B", points: 4 },
      { at: 5, letter: "C", points: 2 },
      { at: 2, letter: "D", points: 1 },
    ],
  },
  {
    id: "tutors",
    group: "access",
    label: "Nonland tutors",
    scale: "per100",
    tiers: [
      { at: 8, letter: "S", points: 8 },
      { at: 5, letter: "A", points: 6 },
      { at: 3, letter: "B", points: 4 },
      { at: 2, letter: "C", points: 2 },
      { at: 1, letter: "D", points: 1 },
    ],
  },
  {
    id: "roleOverlap",
    group: "access",
    label: "Role overlap",
    scale: "absolute",
    tiers: [
      { at: 5, letter: "S", points: 4 },
      { at: 4, letter: "A", points: 3 },
      { at: 3, letter: "B", points: 2 },
      { at: 2, letter: "C", points: 1 },
      { at: 1, letter: "D", points: 1 },
    ],
  },
  {
    id: "earlyThreats",
    group: "pressure",
    label: "Early threats",
    scale: "per100",
    tiers: [
      { at: 20, letter: "S", points: 6 },
      { at: 14, letter: "A", points: 5 },
      { at: 8, letter: "B", points: 3 },
      { at: 4, letter: "C", points: 2 },
      { at: 2, letter: "D", points: 1 },
    ],
  },
  {
    id: "suddenEndings",
    group: "pressure",
    label: "Sudden endings",
    scale: "absolute",
    tiers: [
      { at: 4, letter: "S", points: 10 },
      { at: 3, letter: "A", points: 8 },
      { at: 2, letter: "B", points: 5 },
      { at: 1, letter: "C", points: 3 },
    ],
  },
  {
    id: "nonlandCurve",
    group: "pressure",
    label: "Nonland curve",
    scale: "curve",
    tiers: [
      { at: 2.2, letter: "S", points: 6 },
      { at: 2.8, letter: "A", points: 5 },
      { at: 3.4, letter: "B", points: 3 },
      { at: 3.9, letter: "C", points: 2 },
      { at: 4.5, letter: "D", points: 1 },
    ],
  },
  {
    id: "targetedAnswers",
    group: "interaction",
    label: "Targeted answers",
    scale: "per100",
    tiers: [
      { at: 16, letter: "S", points: 6 },
      { at: 12, letter: "A", points: 5 },
      { at: 8, letter: "B", points: 4 },
      { at: 5, letter: "C", points: 2 },
      { at: 2, letter: "D", points: 1 },
    ],
  },
  {
    id: "boardSweeps",
    group: "interaction",
    label: "Board sweeps",
    scale: "per100",
    tiers: [
      { at: 6, letter: "S", points: 5 },
      { at: 4, letter: "A", points: 4 },
      { at: 3, letter: "B", points: 3 },
      { at: 2, letter: "C", points: 2 },
      { at: 1, letter: "D", points: 1 },
    ],
  },
  {
    id: "manaDenial",
    group: "interaction",
    label: "Mana denial",
    scale: "absolute",
    tiers: [
      { at: 4, letter: "S", points: 6 },
      { at: 3, letter: "A", points: 4 },
      { at: 2, letter: "B", points: 3 },
      { at: 1, letter: "C", points: 2 },
    ],
  },
  {
    id: "shields",
    group: "resilience",
    label: "Shields",
    scale: "per100",
    tiers: [
      { at: 8, letter: "S", points: 4 },
      { at: 5, letter: "A", points: 3 },
      { at: 3, letter: "B", points: 2 },
      { at: 2, letter: "C", points: 1 },
      { at: 1, letter: "D", points: 1 },
    ],
  },
  {
    id: "graveyardReturn",
    group: "resilience",
    label: "Graveyard return",
    scale: "per100",
    tiers: [
      { at: 8, letter: "S", points: 4 },
      { at: 5, letter: "A", points: 3 },
      { at: 3, letter: "B", points: 2 },
      { at: 2, letter: "C", points: 1 },
      { at: 1, letter: "D", points: 1 },
    ],
  },
  {
    id: "standaloneThreats",
    group: "resilience",
    label: "Standalone threats",
    scale: "per100",
    tiers: [
      { at: 16, letter: "S", points: 4 },
      { at: 12, letter: "A", points: 3 },
      { at: 8, letter: "B", points: 2 },
      { at: 4, letter: "C", points: 1 },
      { at: 2, letter: "D", points: 1 },
    ],
  },
];

export const LIST_WEIGHT_MAX = BENCHMARKS.reduce(
  (sum, benchmark) => sum + Math.max(...benchmark.tiers.map((tier) => tier.points)),
  0,
);

const GAME_CHANGER_SET = new Set(GAME_CHANGER_NAMES.map((name) => normalizeCardName(name)));
const MASS_LAND_DENIAL_SET = new Set(MASS_LAND_DENIAL_NAMES.map((name) => normalizeCardName(name)));

/** Lowercase, straight apostrophes, collapsed spaces. */
export function normalizeCardName(name: string): string {
  return name
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function cardNameKeys(name: string): string[] {
  const key = normalizeCardName(name);
  const faces = key.split(" // ").map((face) => face.trim()).filter(Boolean);
  return faces.length > 1 ? [key, ...faces] : [key];
}

export function isGameChangerName(name: string): boolean {
  return cardNameKeys(name).some((key) => {
    if (GAME_CHANGER_SET.has(key)) return true;
    for (const full of GAME_CHANGER_SET) {
      const faces = full.split(" // ");
      if (faces.length > 1 && faces.includes(key)) return true;
    }
    return false;
  });
}

export function isMassLandDenialName(name: string): boolean {
  return cardNameKeys(name).some((key) => MASS_LAND_DENIAL_SET.has(key));
}

export function scoreTier(benchmark: BenchmarkDef, value: number | null): { letter: Letter; points: number } {
  if (value === null || !Number.isFinite(value)) return { letter: "F", points: 0 };
  if (benchmark.scale === "curve") {
    for (const tier of benchmark.tiers) {
      if (value <= tier.at) return { letter: tier.letter, points: tier.points };
    }
    return { letter: "F", points: 0 };
  }
  for (const tier of benchmark.tiers) {
    if (value >= tier.at) return { letter: tier.letter, points: tier.points };
  }
  return { letter: "F", points: 0 };
}
