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

/**
 * Card types of the front face, lowercased, subtypes removed.
 * "Artifact Land — Clue" → "artifact land"; "Artifact // Land" → "artifact".
 */
function frontFaceCardTypes(typeLine: string): string {
  const face = typeLine.split("//")[0] ?? typeLine;
  return (face.split("—")[0] ?? face).toLowerCase();
}

/**
 * A face that is both an artifact and a land (Darksteel Citadel, Seat of the
 * Synod, "Artifact Land — …"). Played as a land drop. A back face doesn't
 * count: "Artifact // Land" is still an artifact.
 */
function isArtifactLand(typeLine: string): boolean {
  const types = frontFaceCardTypes(typeLine);
  return types.includes("artifact") && types.includes("land");
}

export function getPrimaryType(typeLine: string): CardTypeGroup {
  const lower = typeLine.toLowerCase();
  if (lower.includes("creature")) return "Creature";
  if (lower.includes("planeswalker")) return "Planeswalker";
  if (lower.includes("instant")) return "Instant";
  if (lower.includes("sorcery")) return "Sorcery";
  // Before Artifact, so artifact lands join the land pile and land count.
  if (isArtifactLand(typeLine)) return "Land";
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
