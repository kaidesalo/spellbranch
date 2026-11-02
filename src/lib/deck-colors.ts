import { CARD_COLORS } from "@/lib/data/limits";

/**
 * Deck colors: the color combination a deck is built in. A card may be added
 * when its Scryfall color identity fits inside the deck's colors (a subset).
 * Colorless cards fit every deck; a Colorless deck ([]) takes only colorless
 * cards. null means "no colors picked yet" (decks made before this feature)
 * and allows everything.
 *
 * Pure and shared by the actions, both data adapters and the UI. The
 * database repeats the rules in supabase/migrations/008_deck_colors.sql.
 */

export type Color = (typeof CARD_COLORS)[number];

export const COLOR_NAMES: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export interface ColorCombo {
  /** WUBRG-ordered letters; "C" for Colorless. Also the form value. */
  key: string;
  name: string;
  colors: Color[];
  group: "Mono" | "Guilds" | "Shards and wedges" | "Four colors" | "Other";
}

function combo(name: string, letters: string, group: ColorCombo["group"]): ColorCombo {
  const colors = normalizeDeckColors(letters.split(""));
  return { key: colors.length ? colors.join("") : "C", name, colors, group };
}

/** Every color combination, in picker order. Covers all 32 subsets of WUBRG. */
export const COLOR_COMBOS: readonly ColorCombo[] = [
  combo("White", "W", "Mono"),
  combo("Blue", "U", "Mono"),
  combo("Black", "B", "Mono"),
  combo("Red", "R", "Mono"),
  combo("Green", "G", "Mono"),
  combo("Selesnya", "GW", "Guilds"),
  combo("Orzhov", "WB", "Guilds"),
  combo("Boros", "RW", "Guilds"),
  combo("Azorius", "WU", "Guilds"),
  combo("Dimir", "UB", "Guilds"),
  combo("Rakdos", "BR", "Guilds"),
  combo("Golgari", "BG", "Guilds"),
  combo("Izzet", "UR", "Guilds"),
  combo("Simic", "GU", "Guilds"),
  combo("Gruul", "RG", "Guilds"),
  combo("Naya", "RGW", "Shards and wedges"),
  combo("Esper", "WUB", "Shards and wedges"),
  combo("Grixis", "UBR", "Shards and wedges"),
  combo("Jund", "BRG", "Shards and wedges"),
  combo("Bant", "GWU", "Shards and wedges"),
  combo("Abzan", "WBG", "Shards and wedges"),
  combo("Temur", "GUR", "Shards and wedges"),
  combo("Jeskai", "URW", "Shards and wedges"),
  combo("Mardu", "RWB", "Shards and wedges"),
  combo("Sultai", "BGU", "Shards and wedges"),
  combo("Glint", "UBRG", "Four colors"),
  combo("Dune", "WBRG", "Four colors"),
  combo("Ink", "WURG", "Four colors"),
  combo("Witch", "WUBG", "Four colors"),
  combo("Yore", "WUBR", "Four colors"),
  combo("Five Color", "WUBRG", "Other"),
  combo("Colorless", "", "Other"),
];

/** W/U/B/R/G only, once each, in WUBRG order. */
export function normalizeDeckColors(colors: readonly unknown[] | null | undefined): Color[] {
  const set = new Set(Array.isArray(colors) ? colors.flat(Infinity) : []);
  return CARD_COLORS.filter((c) => set.has(c));
}

/** The combo for a set of colors (every subset has one). */
export function comboFor(colors: readonly string[]): ColorCombo {
  const key = normalizeDeckColors(colors).join("") || "C";
  return COLOR_COMBOS.find((c) => c.key === key)!;
}

/** The colors for a picker value ("UB", "C"), or null if it isn't one. */
export function colorsFromKey(key: unknown): Color[] | null {
  if (typeof key !== "string") return null;
  return COLOR_COMBOS.find((c) => c.key === key)?.colors.slice() ?? null;
}

/** "Dimir (Blue, Black)", "White", "Colorless". */
export function describeColors(colors: readonly string[]): string {
  const c = comboFor(colors);
  if (c.colors.length <= 1) return c.name;
  return `${c.name} (${c.colors.map((x) => COLOR_NAMES[x]).join(", ")})`;
}

/** True when a card or commander with this identity may be in the deck. */
export function fitsDeckColors(
  identity: readonly string[],
  deckColors: readonly string[] | null,
): boolean {
  if (deckColors === null) return true;
  return normalizeDeckColors(identity).every((c) => deckColors.includes(c));
}

/** The identity colors outside the deck's colors, in WUBRG order. */
export function colorsOutside(identity: readonly string[], deckColors: readonly string[]): Color[] {
  return normalizeDeckColors(identity).filter((c) => !deckColors.includes(c));
}

/**
 * Why a card can't go in the deck, or null if it can:
 * "Red is outside this deck's colors (Dimir)."
 */
export function offColorReason(
  identity: readonly string[],
  deckColors: readonly string[] | null,
): string | null {
  if (deckColors === null) return null;
  const outside = colorsOutside(identity, deckColors);
  if (outside.length === 0) return null;
  const names = outside.map((c) => COLOR_NAMES[c]);
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} ${names.length === 1 ? "is" : "are"} outside this deck's colors (${comboFor(deckColors).name}).`;
}

/**
 * The identity used for a stored deck card. Cards added before deck colors
 * existed have no stored identity (null); their card colors stand in, which
 * can miss off-color activated abilities or hybrid-free mana symbols in rules
 * text, but never flags a card that does fit.
 */
export function storedCardIdentity(card: {
  colorIdentity?: readonly string[] | null;
  colors?: readonly string[] | null;
}): Color[] {
  return normalizeDeckColors(card.colorIdentity ?? card.colors ?? []);
}

/** Names of the cards that don't fit `deckColors`, sorted, each once. */
export function offColorCardNames(
  cards: readonly { cardName: string; colorIdentity?: readonly string[] | null; colors?: readonly string[] | null }[],
  deckColors: readonly string[] | null,
): string[] {
  const names = cards
    .filter((c) => !fitsDeckColors(storedCardIdentity(c), deckColors))
    .map((c) => c.cardName);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
