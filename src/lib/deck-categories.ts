import { FALLBACK_TYPE_ORDER, getPrimaryType, TYPE_ORDER, type CardTypeGroup } from "@/lib/card-types";
import { LIMITS } from "@/lib/data/limits";
import type { DeckCard, DeckCategory, DeckTypeOrder } from "@/lib/types";

const CATEGORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Custom categories on a deck, and the type groups cards fall back to.
 *
 * A card with no category assignment (and an assignment whose category is
 * gone) is grouped by getPrimaryType, the same rule the deck list used
 * before categories existed. New decks store no category rows, so they
 * look the same as today. The commander is not a category: it stays in
 * its own slot above the list.
 *
 * Custom categories use positions at or above CATEGORY_POSITION_START, so
 * they sit after the type groups until the owner reorders. A reorder writes
 * a packed position for every custom category and every type group in the
 * list. Type groups the owner has not placed yet then follow that list, in
 * the historical type order.
 */

export const CATEGORY_POSITION_START = 1000;

export const CATEGORY_MESSAGES = {
  required: "Category name is required",
  tooLong: `Category name must be at most ${LIMITS.categoryName} characters`,
  lineBreak: "Category name can't include line breaks",
  duplicate: "A category with that name already exists",
  cap: `This deck already has ${LIMITS.deckCategories} categories`,
  notFound: "Category not found",
  denied: "You cannot edit this deck",
  cardMissing: "Card not found in deck",
  reload: "Reload the deck and try again",
} as const;

/** Type groups a card can fall back to. Commander is the pinned slot, not one of these. */
export type FallbackType = (typeof FALLBACK_TYPE_ORDER)[number];

const DEFAULT_TYPE_POSITION: Record<FallbackType, number> = Object.fromEntries(
  FALLBACK_TYPE_ORDER.map((type) => [type, TYPE_ORDER.indexOf(type) * 10]),
) as Record<FallbackType, number>;

export function isFallbackType(value: string): value is FallbackType {
  return (FALLBACK_TYPE_ORDER as readonly string[]).includes(value);
}

/** Code points, not UTF-16 units, so one emoji counts as one character. */
export function categoryNameLength(name: string): number {
  return Array.from(name).length;
}

export function categoryNameKey(name: string): string {
  return name.toLowerCase();
}

export function normalizeCategoryName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: CATEGORY_MESSAGES.required };
  const name = raw.trim();
  if (/[\u0000-\u001F\u007F]/.test(name)) return { ok: false, error: CATEGORY_MESSAGES.lineBreak };
  const length = categoryNameLength(name);
  if (length < 1) return { ok: false, error: CATEGORY_MESSAGES.required };
  if (length > LIMITS.categoryName) return { ok: false, error: CATEGORY_MESSAGES.tooLong };
  return { ok: true, name };
}

/**
 * Next position for a new category. Never below 1000, so it sorts after the
 * default type groups. After a reorder (positions 0, 1, 2, …) it still lands
 * at the end of that list, because 1000 is past those positions.
 */
export function nextCategoryPosition(categories: { position: number }[]): number {
  let max = CATEGORY_POSITION_START - 1;
  for (const category of categories) {
    if (category.position > max) max = category.position;
  }
  return max + 1;
}

export interface DeckSection {
  key: string;
  label: string;
  kind: "category" | "type";
  categoryId: string | null;
  typeKey: FallbackType | null;
  cards: DeckCard[];
  count: number;
  position: number;
}

export type SectionItem =
  | { kind: "category"; id: string }
  | { kind: "type"; typeKey: FallbackType };

export function sectionKey(section: {
  kind: "category" | "type";
  categoryId: string | null;
  typeKey: string | null;
}): string {
  return section.kind === "category" ? section.categoryId! : `type:${section.typeKey}`;
}

/**
 * The owner's arranged list. Every custom category must appear once.
 * Type keys are optional (a type with no cards is not shown). Anything else
 * is refused so a stale client can't drop a category.
 */
export function parseSectionOrder(
  categoryIds: readonly string[],
  keys: readonly string[],
): { ok: true; items: SectionItem[] } | { ok: false; error: string } {
  const error = { ok: false as const, error: CATEGORY_MESSAGES.reload };
  const max = LIMITS.deckCategories + FALLBACK_TYPE_ORDER.length;
  if (!Array.isArray(keys) || keys.length > max) return error;
  const remaining = new Set(categoryIds);
  const seenTypes = new Set<string>();
  const items: SectionItem[] = [];
  for (const key of keys) {
    if (typeof key !== "string") return error;
    if (CATEGORY_ID_RE.test(key)) {
      if (!remaining.has(key)) return error;
      remaining.delete(key);
      items.push({ kind: "category", id: key });
      continue;
    }
    if (key.startsWith("type:")) {
      const typeKey = key.slice("type:".length);
      if (!isFallbackType(typeKey) || seenTypes.has(typeKey)) return error;
      seenTypes.add(typeKey);
      items.push({ kind: "type", typeKey });
      continue;
    }
    return error;
  }
  if (remaining.size > 0) return error;
  return { ok: true, items };
}

function fallbackTypeOf(typeLine: string): FallbackType {
  const primary: CardTypeGroup = getPrimaryType(typeLine);
  return isFallbackType(primary) ? primary : "Other";
}

function byName(a: DeckCard, b: DeckCard): number {
  return a.cardName.localeCompare(b.cardName) || a.id.localeCompare(b.id);
}

/**
 * Custom categories (including empty ones) plus type groups that still have
 * cards. An unknown categoryId falls back to the card's type group, which
 * is also what deleting a category does.
 */
export function groupDeckCards(
  cards: DeckCard[],
  categories: DeckCategory[] = [],
  typeOrders: DeckTypeOrder[] = [],
): DeckSection[] {
  const cats = [...categories].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const byId = new Map(cats.map((category) => [category.id, category]));
  const customCards = new Map<string, DeckCard[]>(cats.map((category) => [category.id, []]));
  const typeCards = new Map<FallbackType, DeckCard[]>(FALLBACK_TYPE_ORDER.map((type) => [type, []]));

  for (const card of cards) {
    const assigned = card.categoryId ? byId.get(card.categoryId) : undefined;
    if (assigned) customCards.get(assigned.id)!.push(card);
    else typeCards.get(fallbackTypeOf(card.typeLine))!.push(card);
  }

  const storedType = new Map<FallbackType, number>();
  for (const row of typeOrders) {
    if (isFallbackType(row.typeKey)) storedType.set(row.typeKey, row.position);
  }
  const arranged = typeOrders.length > 0 || cats.some((category) => category.position < CATEGORY_POSITION_START);
  const knownPositions = [...cats.map((category) => category.position), ...storedType.values()];
  let appendAt = (knownPositions.length > 0 ? Math.max(...knownPositions) : -1) + 1;

  const sections: DeckSection[] = cats.map((category) => {
    const list = customCards.get(category.id)!.sort(byName);
    return {
      key: category.id,
      label: category.name,
      kind: "category" as const,
      categoryId: category.id,
      typeKey: null,
      cards: list,
      count: list.reduce((sum, card) => sum + card.quantity, 0),
      position: category.position,
    };
  });

  for (const type of FALLBACK_TYPE_ORDER) {
    const list = typeCards.get(type)!.sort(byName);
    if (list.length === 0) continue;
    const stored = storedType.get(type);
    const position = stored !== undefined ? stored : arranged ? appendAt++ : DEFAULT_TYPE_POSITION[type];
    sections.push({
      key: `type:${type}`,
      label: type,
      kind: "type",
      categoryId: null,
      typeKey: type,
      cards: list,
      count: list.reduce((sum, card) => sum + card.quantity, 0),
      position,
    });
  }

  sections.sort(
    (a, b) => a.position - b.position || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
  );
  return sections;
}
