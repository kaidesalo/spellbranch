import { LIMITS } from "@/lib/data/limits";
import { MAX_CARD_QUANTITY, clampQuantity } from "@/lib/deck-quantity";
import { canonicalizePrintedName, cardLookupKey } from "@/lib/decklist/names";

/**
 * Pasteable decklists from Moxfield and Archidekt, plus the same plain-text
 * shape those sites import.
 *
 * No network. A deck URL is refused by pastedListProblem — Moxfield blocks
 * other sites from downloading decks (and its unofficial API wants a browser
 * clearance cookie), and Archidekt has no supported public download. The
 * importer never fetches those hosts.
 *
 * Lines we accept:
 *   1 Sol Ring
 *   1x Sol Ring
 *   1 Sol Ring (C21) 263
 *   1 Sol Ring (C21) 263 *F*
 *   10 Forest
 *   Sol Ring                          (quantity 1)
 *   1 Atraxa, Praetors' Voice *CMDR*
 *
 * Commander, when the caller asks for it (Commander format):
 *   - a Commander / Commanders heading (Archidekt //Commander, or a bare line)
 *   - a *CMDR* or (Commander) tag
 *   - Moxfield plain text: 1–2 card lines, a blank line, then the deck
 *
 * Sideboard, maybeboard, considering, tokens and similar piles are counted
 * in warnings and left out. Other headings (Creatures, Lands, //Ramp) stay
 * in the deck.
 */

export const DECKLIST_MAX_CHARS = 80_000;

const MOXFIELD_URL =
  "Paste the exported list, not a Moxfield link. Moxfield doesn't let other sites download decks. On the deck, use More → Export → Plain Text, then paste that here.";
const ARCHIDEKT_URL =
  "Paste the exported list, not an Archidekt link. On the deck, use Export → Text, then paste that here. Spellbranch does not download Archidekt decks.";
const OTHER_URL = "Paste the deck list itself, not a link.";

const COMMANDER_HEADERS = new Set(["commander", "commanders", "command zone"]);
const SKIP_HEADERS = new Set([
  "sideboard",
  "sideboards",
  "sb",
  "maybeboard",
  "considering",
  "wishlist",
  "acquisition",
  "tokens",
  "token",
  "schemes",
  "scheme",
  "planes",
  "plane",
  "attractions",
  "attraction",
  "stickers",
  "sticker",
  "companion",
  "companions",
  "signature spell",
  "signature spells",
]);
/** Bare lines (no //) that start a main-deck section, not a card name. */
const MAIN_HEADERS = new Set([
  "deck",
  "decks",
  "main",
  "mainboard",
  "main board",
  "cards",
  "creature",
  "creatures",
  "instant",
  "instants",
  "sorcery",
  "sorceries",
  "enchantment",
  "enchantments",
  "artifact",
  "artifacts",
  "planeswalker",
  "planeswalkers",
  "battle",
  "battles",
  "land",
  "lands",
  "basic land",
  "basic lands",
  "other",
  "spell",
  "spells",
]);

type Section = "commander" | "main" | "skip";

export interface DecklistCard {
  name: string;
  quantity: number;
}

export interface ParsedDecklist {
  commanders: DecklistCard[];
  cards: DecklistCard[];
  warnings: string[];
}

export interface ParseDecklistOptions {
  /**
   * Moxfield plain text puts the commander (one card, or two for partners)
   * on the lines before the first blank line, with no heading. Only used
   * for Commander imports, and only when the paste has no section headings
   * and no commander tag.
   */
  commanderBlankLine?: boolean;
}

type CardToken = {
  kind: "card";
  name: string;
  quantity: number;
  commander: boolean;
  capped: boolean;
  /** null: follow the current section. */
  section: Section | null;
};

type Token =
  | { kind: "blank" }
  | { kind: "header"; section: Section; label: string }
  | CardToken
  | { kind: "junk"; raw: string };

const CARD_LINE = /^(\d+)(?:[xX×]\s+|\s+)(.+)$/;

/**
 * Why this paste can't be imported, or null when it should be parsed.
 * Static text only: the URL itself is never echoed back (it may carry
 * userinfo) and is never fetched.
 */
export function pastedListProblem(text: string): string | null {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return "Paste a deck list.";
  if (trimmed.length > DECKLIST_MAX_CHARS) return "That list is too long to import.";
  if (!/^https?:\/\//i.test(trimmed) || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (host === "moxfield.com" || host.endsWith(".moxfield.com")) return MOXFIELD_URL;
  if (host === "archidekt.com" || host.endsWith(".archidekt.com")) return ARCHIDEKT_URL;
  return OTHER_URL;
}

export function parseDecklist(text: string, options: ParseDecklistOptions = {}): ParsedDecklist {
  const tokens = tokenize(text.replace(/^\uFEFF/, ""));
  const tagged = tokens.some((token) => token.kind === "card" && token.commander);
  const headed = tokens.some((token) => token.kind === "header");
  if (options.commanderBlankLine && !tagged && !headed) markMoxfieldCommander(tokens);
  return assemble(tokens);
}

function headerKey(label: string): string {
  return label.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function sectionFor(label: string): Section {
  const key = headerKey(label);
  if (COMMANDER_HEADERS.has(key)) return "commander";
  if (SKIP_HEADERS.has(key) || /\b(maybeboard|sideboard|considering)\b/.test(key)) return "skip";
  return "main";
}

function knownBareHeader(line: string): string | null {
  const label = line
    .trim()
    .replace(/:$/, "")
    .trim()
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
  if (!label) return null;
  const key = headerKey(label);
  if (COMMANDER_HEADERS.has(key) || SKIP_HEADERS.has(key) || MAIN_HEADERS.has(key)) return label;
  return null;
}

/** //Commander, # Commander, == Commander ==. Null when it isn't a heading. */
function slashHeading(line: string): string | null {
  const trimmed = line.trim();
  let body: string | null = null;
  const wrapped = trimmed.match(/^==\s*(.+?)\s*==$/);
  if (wrapped) body = wrapped[1] ?? null;
  else if (trimmed.startsWith("//")) body = trimmed.slice(2).trim();
  else if (/^#\s+\S/.test(trimmed)) body = trimmed.replace(/^#\s+/, "").trim();
  if (body === null) return null;
  const label = body.replace(/\s*\(\d+\)\s*$/, "").trim();
  if (!label || label.length > 40 || label.split(/\s+/).length > 4 || /[.!?]/.test(label)) return null;
  return label;
}

function stripOneSuffix(value: string): { next: string; commander: boolean } | null {
  const foil = value.match(/^(.*)\s+\*(?:F|E|FOIL|ETCHED|ETCH)\*$/i);
  if (foil?.[1]) return { next: foil[1].trim(), commander: false };
  const star = value.match(/^(.*)\s+\*(?:CMDR|COMMANDER)\*$/i);
  if (star?.[1]) return { next: star[1].trim(), commander: true };
  const paren = value.match(/^(.*)\s+\((?:cmdr|commander)\)$/i);
  if (paren?.[1]) return { next: paren[1].trim(), commander: true };
  const bracket = value.match(/^(.*)\s+\[([A-Za-z0-9]{2,6})(?:#[A-Za-z0-9-]+)?\]$/);
  if (bracket?.[1] && bracket[2] && /[A-Za-z]/.test(bracket[2])) {
    return { next: bracket[1].trim(), commander: false };
  }
  const set = value.match(/^(.*)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+#?[A-Za-z0-9-]+)?$/);
  if (set?.[1] && set[2] && /[A-Za-z]/.test(set[2])) {
    return { next: set[1].trim(), commander: false };
  }
  return null;
}

function cleanPrintedName(raw: string): { name: string; commanderTag: boolean } {
  let s = raw.trim();
  let commanderTag = false;
  for (let i = 0; i < 8; i++) {
    const stripped = stripOneSuffix(s);
    if (!stripped || !stripped.next) break;
    if (stripped.commander) commanderTag = true;
    s = stripped.next;
  }
  return { name: canonicalizePrintedName(s), commanderTag };
}

function usableName(name: string): boolean {
  return name.length > 0 && name.length <= LIMITS.cardName && /\p{L}/u.test(name);
}

function cardFromPieces(
  rawQty: number,
  rawName: string,
  section: Section | null,
): CardToken | { kind: "junk" } {
  if (!Number.isSafeInteger(rawQty) || rawQty < 1) return { kind: "junk" };
  const cleaned = cleanPrintedName(rawName);
  if (!usableName(cleaned.name)) return { kind: "junk" };
  const quantity = clampQuantity(rawQty);
  return {
    kind: "card",
    name: cleaned.name,
    quantity,
    commander: cleaned.commanderTag,
    capped: quantity !== rawQty,
    section,
  };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      tokens.push({ kind: "blank" });
      continue;
    }

    const sb = line.match(/^SB\s*:\s*(.+)$/i);
    if (sb?.[1]) {
      const card = parseCardOrBare(sb[1], "skip");
      tokens.push(card ?? { kind: "junk", raw: clip(line) });
      continue;
    }

    const inline = line.match(
      /^(commander|commanders|sideboard|maybeboard|deck|mainboard|main|companion)\s*:\s*(.*)$/i,
    );
    if (inline?.[1]) {
      const label = inline[1];
      const rest = (inline[2] ?? "").trim();
      const section = sectionFor(label);
      if (!rest) {
        tokens.push({ kind: "header", section, label });
        continue;
      }
      const card = parseCardOrBare(rest, section);
      tokens.push(card ?? { kind: "junk", raw: clip(line) });
      continue;
    }

    const numbered = line.match(CARD_LINE);
    if (numbered?.[1] && numbered[2]) {
      const card = cardFromPieces(Number(numbered[1]), numbered[2], null);
      tokens.push(card.kind === "card" ? card : { kind: "junk", raw: clip(line) });
      continue;
    }

    if (line.startsWith("//") || /^==.+==$/.test(line) || /^#\s+\S/.test(line)) {
      const label = slashHeading(line);
      if (label) tokens.push({ kind: "header", section: sectionFor(label), label });
      continue;
    }

    const bare = knownBareHeader(line);
    if (bare) {
      tokens.push({ kind: "header", section: sectionFor(bare), label: bare });
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      tokens.push({ kind: "junk", raw: "a link" });
      continue;
    }

    const card = cardFromPieces(1, line, null);
    tokens.push(card.kind === "card" ? card : { kind: "junk", raw: clip(line) });
  }
  return tokens;
}

function parseCardOrBare(text: string, section: Section): CardToken | null {
  const numbered = text.trim().match(CARD_LINE);
  const card = numbered?.[1] && numbered[2]
    ? cardFromPieces(Number(numbered[1]), numbered[2], section)
    : cardFromPieces(1, text, section);
  return card.kind === "card" ? card : null;
}

function clip(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

/**
 * Moxfield: the card lines before the first blank line are the commander
 * when that opening group is one or two cards and at least one card follows.
 */
function markMoxfieldCommander(tokens: Token[]) {
  let i = 0;
  while (tokens[i]?.kind === "blank") i++;
  const preface: CardToken[] = [];
  while (tokens[i]?.kind === "card") {
    preface.push(tokens[i] as CardToken);
    i++;
  }
  if (preface.length < 1 || preface.length > 2) return;
  if (tokens[i]?.kind !== "blank") return;
  while (tokens[i]?.kind === "blank") i++;
  if (!tokens.slice(i).some((token) => token.kind === "card")) return;
  for (const card of preface) card.commander = true;
}

function addCard(list: DecklistCard[], name: string, quantity: number, capped: string[]) {
  const key = cardLookupKey(name);
  const existing = list.find((card) => cardLookupKey(card.name) === key);
  if (!existing) {
    list.push({ name, quantity });
    return;
  }
  const sum = existing.quantity + quantity;
  if (sum > MAX_CARD_QUANTITY) {
    existing.quantity = MAX_CARD_QUANTITY;
    capped.push(existing.name);
  } else {
    existing.quantity = sum;
  }
}

function assemble(tokens: Token[]): ParsedDecklist {
  const commanders: DecklistCard[] = [];
  const cards: DecklistCard[] = [];
  const capped: string[] = [];
  const junk: string[] = [];
  const skipped = new Map<string, { label: string; count: number }>();
  let current: Section = "main";
  let skipLabel = "Sideboard";

  for (const token of tokens) {
    if (token.kind === "blank") continue;
    if (token.kind === "header") {
      current = token.section;
      if (token.section === "skip") skipLabel = token.label.trim() || "Sideboard";
      continue;
    }
    if (token.kind === "junk") {
      junk.push(token.raw);
      continue;
    }
    if (token.capped) capped.push(token.name);
    const section = token.commander ? "commander" : (token.section ?? current);
    if (section === "skip") {
      // An `SB:` line while another pile is open is still a sideboard card.
      const label = token.section === "skip" && current !== "skip" ? "Sideboard" : skipLabel;
      const key = headerKey(label);
      const row = skipped.get(key) ?? { label, count: 0 };
      row.count += token.quantity;
      skipped.set(key, row);
      continue;
    }
    addCard(section === "commander" ? commanders : cards, token.name, token.quantity, capped);
  }

  const warnings: string[] = [];
  const uniqueCapped = [...new Set(capped)];
  for (const name of uniqueCapped.slice(0, 8)) {
    warnings.push(`${name} was brought down to ${MAX_CARD_QUANTITY} copies.`);
  }
  if (uniqueCapped.length > 8) {
    warnings.push(`${uniqueCapped.length - 8} more cards were brought down to ${MAX_CARD_QUANTITY} copies.`);
  }
  for (const { label, count } of skipped.values()) {
    warnings.push(
      `Skipped ${count} ${count === 1 ? "card" : "cards"} from ${label}. Those piles aren't part of the Spellbranch deck.`,
    );
  }
  if (junk.length > 0) {
    const shown = junk.slice(0, 3).map((line) => `"${line}"`).join(", ");
    const more = junk.length > 3 ? ` (+${junk.length - 3} more)` : "";
    warnings.push(`Couldn't read ${junk.length === 1 ? "1 line" : `${junk.length} lines`}: ${shown}${more}.`);
  }
  return { commanders, cards, warnings };
}
