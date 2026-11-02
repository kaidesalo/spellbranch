/**
 * Mana and card symbols in Scryfall notation ("{2}{B}{B}", "{W/U}", "{T}").
 *
 * parseSymbols() splits any text into plain-text parts and symbol parts, so
 * the same parser serves mana costs and Oracle text. Symbols we know get a
 * slug (the file name of the icon in /public/mana) and an English label for
 * screen readers. Anything else in braces stays literal text, e.g. "{?}".
 *
 * Icons: Scryfall's card symbol SVGs (https://api.scryfall.com/symbology),
 * vendored in /public/mana so pages never call a third party for them. File
 * names are the symbol without braces or slashes: {W/U/P} -> WUP.svg. The
 * symbols are Wizards of the Coast IP, shown under the same Fan Content
 * Policy terms as the card images.
 */

/** Every symbol icon in /public/mana (tests check the two agree). */
export const MANA_SYMBOL_SLUGS = [
  // Generic
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "X", "Y", "Z",
  // Colors, colorless, snow
  "W", "U", "B", "R", "G", "C", "S",
  // Hybrid
  "WU", "WB", "UB", "UR", "BR", "BG", "RG", "RW", "GW", "GU",
  // Colorless hybrid and two-generic hybrid ("2-brid")
  "CW", "CU", "CB", "CR", "CG",
  "2W", "2U", "2B", "2R", "2G",
  // Phyrexian, hybrid Phyrexian, and {H}
  "WP", "UP", "BP", "RP", "GP", "H",
  "WUP", "WBP", "UBP", "URP", "BRP", "BGP", "RGP", "RWP", "GWP", "GUP",
  // Oracle text symbols
  "T", "Q", "E", "P", "PW", "CHAOS", "TK",
] as const;

const KNOWN = new Set<string>(MANA_SYMBOL_SLUGS);

const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen", "Twenty",
];

const OTHER_LABELS: Record<string, string> = {
  S: "Snow",
  H: "Phyrexian, any color",
  T: "Tap",
  Q: "Untap",
  E: "Energy",
  P: "Pawprint",
  PW: "Planeswalker",
  CHAOS: "Chaos",
  TK: "Ticket",
};

/** English label for a known slug, e.g. "BP" -> "Phyrexian Black". */
function labelFor(slug: string): string {
  if (/^\d+$/.test(slug)) {
    const n = Number(slug);
    return n === 0 ? "Zero mana" : `${NUMBER_WORDS[n]} generic mana`;
  }
  if (slug === "X" || slug === "Y" || slug === "Z") return `${slug} generic mana`;
  if (OTHER_LABELS[slug]) return OTHER_LABELS[slug];

  const phyrexian = slug.length > 1 && slug.endsWith("P");
  const parts = (phyrexian ? slug.slice(0, -1) : slug)
    .split("")
    .map((c) => (c === "2" ? "Two generic" : COLOR_NAMES[c]));
  const name = parts.length === 1 ? parts[0] : `${parts.join(" or ")} hybrid`;
  return phyrexian ? `Phyrexian ${name}` : name;
}

export interface ManaSymbol {
  kind: "symbol";
  /** As written, e.g. "{W/U}". */
  text: string;
  /** Icon file name without .svg, e.g. "WU". */
  slug: string;
  /** Screen reader label, e.g. "White or Blue hybrid". */
  label: string;
}

export interface TextPart {
  kind: "text";
  text: string;
}

export type SymbolPart = ManaSymbol | TextPart;

/** The symbol for "{...}", or null if we don't have an icon for it. */
export function resolveSymbol(token: string): ManaSymbol | null {
  const inner = token.replace(/^\{|\}$/g, "").toUpperCase();
  const slug = inner.replace(/\//g, "");
  if (!KNOWN.has(slug)) return null;
  return { kind: "symbol", text: token, slug, label: labelFor(slug) };
}

/**
 * Splits text into plain-text and symbol parts. Unknown braces stay in the
 * text. Neighbouring text is merged, so "a {?} b" is one text part.
 */
export function parseSymbols(text: string | null | undefined): SymbolPart[] {
  if (!text) return [];
  const parts: SymbolPart[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += s;
    else parts.push({ kind: "text", text: s });
  };

  let at = 0;
  for (const match of text.matchAll(/\{[^{}]+\}/g)) {
    pushText(text.slice(at, match.index));
    const symbol = resolveSymbol(match[0]);
    if (symbol) parts.push(symbol);
    else pushText(match[0]);
    at = match.index + match[0].length;
  }
  pushText(text.slice(at));
  return parts;
}

/**
 * The whole cost in words, for aria-label. Faces of a double-faced or split
 * cost (" // ") are read as "…, or …"; unknown symbols are read as written.
 */
export function manaCostLabel(cost: string | null | undefined): string {
  if (!cost) return "";
  return cost
    .split(" // ")
    .map((face) =>
      parseSymbols(face)
        .map((p) => (p.kind === "symbol" ? p.label : p.text.trim()))
        .filter(Boolean)
        .join(", "),
    )
    .filter(Boolean)
    .join("; or ");
}
