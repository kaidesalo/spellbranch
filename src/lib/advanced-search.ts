/**
 * Cards advanced search compiles to a Scryfall query. User text is always
 * quoted so quotes, parentheses, and operators stay inside their own term.
 * order, dir, and unique are display syntax and API parameters, not part of q.
 */

export const SEARCH_QUERY_MAX_CODE_POINTS = 200;
export const SEARCH_PAGE_MAX = 10;

export const FORMAT_FILTERS = [
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "commander",
  "oathbreaker",
  "brawl",
  "timeless",
  "historic",
  "pauper",
] as const;

export const COLOR_PIPS = [
  { id: "w", label: "White" },
  { id: "u", label: "Blue" },
  { id: "b", label: "Black" },
  { id: "r", label: "Red" },
  { id: "g", label: "Green" },
  { id: "c", label: "Colorless" },
] as const;

export const COLOR_MODES = ["exactly", "including", "atMost"] as const;
export const MANA_OPS = ["=", ">=", "<=", ">", "<"] as const;
export const RARITY_FILTERS = ["common", "uncommon", "rare", "mythic", "special"] as const;
export const SORT_ORDERS = ["name", "released", "rarity", "cmc", "color", "artist", "set"] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export type FormatFilter = (typeof FORMAT_FILTERS)[number];
export type ColorPip = (typeof COLOR_PIPS)[number]["id"];
export type ColorMode = (typeof COLOR_MODES)[number];
export type ManaOp = (typeof MANA_OPS)[number];
export type RarityFilter = (typeof RARITY_FILTERS)[number];
export type SortOrder = (typeof SORT_ORDERS)[number];
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export type AdvancedFilters = {
  formats: FormatFilter[];
  colors: ColorPip[];
  colorMode: ColorMode;
  colorIdentity: boolean;
  typeLine: string;
  oracle: string[];
  manaValue: string;
  manaOp: ManaOp;
  rarities: RarityFilter[];
  setCode: string;
  setExcluded: boolean;
  order: "" | SortOrder;
  direction: "" | SortDirection;
  uniquePrints: boolean;
};

export const EMPTY_ADVANCED_FILTERS: AdvancedFilters = {
  formats: [],
  colors: [],
  colorMode: "exactly",
  colorIdentity: false,
  typeLine: "",
  oracle: [],
  manaValue: "",
  manaOp: "=",
  rarities: [],
  setCode: "",
  setExcluded: false,
  order: "",
  direction: "",
  uniquePrints: false,
};

export type CompiledAdvancedQuery = {
  /** Scryfall `q` value. Order, direction, and unique stay out of this string. */
  q: string;
  /** Read-only syntax, including order, dir, and unique when set. */
  display: string;
  order?: SortOrder;
  dir?: SortDirection;
  unique?: "prints";
};

const FORMAT_SET = new Set<string>(FORMAT_FILTERS);
const COLOR_SET = new Set<string>(COLOR_PIPS.map((pip) => pip.id));
const RARITY_SET = new Set<string>(RARITY_FILTERS);
const ORDER_SET = new Set<string>(SORT_ORDERS);
const DIR_SET = new Set<string>(SORT_DIRECTIONS);
const MANA_OP_SET = new Set<string>(MANA_OPS);
const SET_CODE = /^[a-z0-9]{2,10}$/i;
const COLOR_OP: Record<ColorMode, "=" | ">=" | "<="> = {
  exactly: "=",
  including: ">=",
  atMost: "<=",
};

export function codePointLength(value: string): number {
  return [...value].length;
}

/** 1 when omitted. Null when the value is not an integer from 1 through the max. */
export function parseSearchPage(raw: string | null): number | null {
  if (raw == null || raw === "") return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1 || page > SEARCH_PAGE_MAX) return null;
  return page;
}

export function validateSearchInput(
  q: string,
  pageRaw: string | null,
): { ok: true; page: number } | { ok: false; error: string } {
  if (codePointLength(q) > SEARCH_QUERY_MAX_CODE_POINTS) {
    return { ok: false, error: "Search query is too long" };
  }
  const page = parseSearchPage(pageRaw);
  if (page == null) return { ok: false, error: "Page is invalid" };
  return { ok: true, page };
}

/** Quote user text so it cannot close the term or add operators. */
export function quoteScryfallTerm(value: string): string | null {
  const text = value.trim();
  if (!text || codePointLength(text) > 80) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function orGroup(prefix: string, values: string[]): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return `${prefix}${values[0]}`;
  return `(${values.map((value) => `${prefix}${value}`).join(" OR ")})`;
}

function colorClause(filters: AdvancedFilters): string | null {
  const selected = COLOR_PIPS.map((pip) => pip.id).filter((id) => filters.colors.includes(id));
  if (selected.length === 0) return null;
  const key = filters.colorIdentity ? "id" : "c";
  if (selected.includes("c")) return `${key}=c`;
  const op = COLOR_OP[filters.colorMode] ?? "=";
  return `${key}${op}${selected.join("")}`;
}

function manaClause(filters: AdvancedFilters): string | null {
  if (!/^\d{1,2}$/.test(filters.manaValue)) return null;
  const value = Number(filters.manaValue);
  if (!Number.isInteger(value) || value < 0 || value > 20) return null;
  const op = MANA_OP_SET.has(filters.manaOp) ? filters.manaOp : "=";
  return `mv${op}${value}`;
}

function setClause(filters: AdvancedFilters): string | null {
  const code = filters.setCode.trim().toLowerCase();
  if (!SET_CODE.test(code)) return null;
  return `${filters.setExcluded ? "-" : ""}e:${code}`;
}

export function compileAdvancedQuery(name: string, filters: AdvancedFilters): CompiledAdvancedQuery {
  const clauses: string[] = [];
  const quotedName = quoteScryfallTerm(name);
  if (quotedName) clauses.push(`name:${quotedName}`);

  const formats = filters.formats.filter((format) => FORMAT_SET.has(format));
  const formatClause = orGroup("f:", formats);
  if (formatClause) clauses.push(formatClause);

  const colors = colorClause({ ...filters, colors: filters.colors.filter((color) => COLOR_SET.has(color)) });
  if (colors) clauses.push(colors);

  const typeLine = quoteScryfallTerm(filters.typeLine);
  if (typeLine) clauses.push(`t:${typeLine}`);

  for (const chip of filters.oracle) {
    const quoted = quoteScryfallTerm(chip);
    if (quoted) clauses.push(`o:${quoted}`);
  }

  const mana = manaClause(filters);
  if (mana) clauses.push(mana);

  const rarities = filters.rarities.filter((rarity) => RARITY_SET.has(rarity));
  const rarityClause = orGroup("r:", rarities);
  if (rarityClause) clauses.push(rarityClause);

  const set = setClause(filters);
  if (set) clauses.push(set);

  const q = clauses.join(" ");
  const displayParts = [q];
  const order = ORDER_SET.has(filters.order) ? filters.order : "";
  const direction = DIR_SET.has(filters.direction) ? filters.direction : "";
  if (order) {
    displayParts.push(`order:${order}`);
    if (direction) displayParts.push(`dir:${direction}`);
  }
  if (filters.uniquePrints) displayParts.push("unique:prints");

  return {
    q,
    display: displayParts.filter(Boolean).join(" "),
    order: order || undefined,
    dir: order && direction ? direction : undefined,
    unique: filters.uniquePrints ? "prints" : undefined,
  };
}

export function advancedFiltersActive(filters: AdvancedFilters): boolean {
  return compileAdvancedQuery("", filters).display.length > 0;
}

export function toggleFormat(filters: AdvancedFilters, format: FormatFilter): AdvancedFilters {
  const formats = filters.formats.includes(format)
    ? filters.formats.filter((item) => item !== format)
    : [...filters.formats, format];
  return { ...filters, formats };
}

export function toggleColor(filters: AdvancedFilters, color: ColorPip): AdvancedFilters {
  const selected = filters.colors.includes(color);
  if (color === "c") {
    return { ...filters, colors: selected ? [] : ["c"] };
  }
  const colors = selected
    ? filters.colors.filter((item) => item !== color)
    : [...filters.colors.filter((item) => item !== "c"), color];
  return { ...filters, colors };
}

export function toggleRarity(filters: AdvancedFilters, rarity: RarityFilter): AdvancedFilters {
  const rarities = filters.rarities.includes(rarity)
    ? filters.rarities.filter((item) => item !== rarity)
    : [...filters.rarities, rarity];
  return { ...filters, rarities };
}
