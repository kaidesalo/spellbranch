import type { DeckCard } from "@/lib/types";

const TYPE_ORDER = [
  "Commander",
  "Creature",
  "Planeswalker",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Battle",
  "Land",
  "Other",
] as const;

export type CardTypeGroup = (typeof TYPE_ORDER)[number];

export function getPrimaryType(typeLine: string): CardTypeGroup {
  const lower = typeLine.toLowerCase();
  if (lower.includes("creature")) return "Creature";
  if (lower.includes("planeswalker")) return "Planeswalker";
  if (lower.includes("instant")) return "Instant";
  if (lower.includes("sorcery")) return "Sorcery";
  if (lower.includes("artifact")) return "Artifact";
  if (lower.includes("enchantment")) return "Enchantment";
  if (lower.includes("battle")) return "Battle";
  if (lower.includes("land")) return "Land";
  return "Other";
}

export function groupCardsByType(cards: DeckCard[]) {
  const groups = new Map<CardTypeGroup, DeckCard[]>();
  for (const type of TYPE_ORDER) groups.set(type, []);

  for (const card of cards) {
    const type = getPrimaryType(card.typeLine);
    groups.get(type)!.push(card);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.cardName.localeCompare(b.cardName));
  }

  return TYPE_ORDER.map((type) => ({
    type,
    cards: groups.get(type)!,
    count: groups.get(type)!.reduce((sum, c) => sum + c.quantity, 0),
  })).filter((g) => g.cards.length > 0);
}

export function totalCards(cards: DeckCard[]) {
  return cards.reduce((sum, c) => sum + c.quantity, 0);
}
