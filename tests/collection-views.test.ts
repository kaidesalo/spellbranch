import { describe, expect, it } from "vitest";
import { deckBinders, fullCollection, inDecks, tradeBinder, type DeckCardRef } from "@/lib/collection-views";
import type { CollectionCard } from "@/lib/types";

function pile(over: Partial<CollectionCard> & Pick<CollectionCard, "id" | "cardName">): CollectionCard {
  return {
    userId: "me",
    scryfallId: over.id,
    imageUri: null,
    manaCost: null,
    typeLine: "Instant",
    quantity: 1,
    finish: "nonfoil",
    condition: "NM",
    forTrade: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const boltFoil = pile({
  id: "foil",
  scryfallId: "bolt-foil-print",
  cardName: "Lightning Bolt",
  quantity: 2,
  finish: "foil",
  condition: "LP",
  forTrade: true,
});
const boltPaper = pile({
  id: "paper",
  scryfallId: "bolt-paper-print",
  cardName: "Lightning Bolt",
  quantity: 4,
  finish: "nonfoil",
  condition: "NM",
  forTrade: false,
});
const ring = pile({
  id: "ring",
  scryfallId: "sol-ring",
  cardName: "Sol Ring",
  quantity: 1,
  forTrade: false,
});

const decks: DeckCardRef[] = [
  { deckId: "d1", deckName: "Burn", scryfallId: "other-bolt-print", cardName: "Lightning Bolt" },
  { deckId: "d2", deckName: "Squirrels", scryfallId: "bolt-paper-print", cardName: "Lightning Bolt" },
];

describe("collection views", () => {
  it("sums every pile in the full collection and keeps finish and condition", () => {
    const groups = fullCollection([ring, boltFoil, boltPaper], decks);
    expect(groups.map((group) => group.name)).toEqual(["Lightning Bolt", "Sol Ring"]);
    const bolt = groups[0]!;
    expect(bolt.quantity).toBe(6);
    expect(bolt.piles.map((pile) => [pile.finish, pile.condition, pile.quantity])).toEqual([
      ["foil", "LP", 2],
      ["nonfoil", "NM", 4],
    ]);
    expect(groups[1]!.decks).toEqual([]);
  });

  it("lists owned cards that are in a deck, including a different printing, and skips the rest", () => {
    const groups = inDecks([ring, boltFoil, boltPaper], decks);
    expect(groups.map((group) => group.name)).toEqual(["Lightning Bolt"]);
    expect(groups[0]!.decks).toEqual([
      { id: "d1", name: "Burn" },
      { id: "d2", name: "Squirrels" },
    ]);
    expect(groups[0]!.piles).toHaveLength(2);
  });

  it("keeps only piles marked for trade", () => {
    const groups = tradeBinder([ring, boltFoil, boltPaper], decks);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.quantity).toBe(2);
    expect(groups[0]!.piles.map((pile) => pile.id)).toEqual(["foil"]);
    expect(groups[0]!.piles[0]!.forTrade).toBe(true);
  });

  it("builds one binder per owned deck and includes the commander", () => {
    const atraxa = pile({
      id: "atraxa",
      scryfallId: "atraxa-showcase",
      cardName: "Atraxa, Praetors' Voice",
      typeLine: "Legendary Creature — Phyrexian Angel",
    });
    const refs: DeckCardRef[] = [
      ...decks,
      { deckId: "d1", deckName: "Burn", scryfallId: "sol-ring-other", cardName: "Sol Ring" },
      { deckId: "d3", deckName: "Atraxa", scryfallId: "atraxa-original", cardName: "Atraxa, Praetors' Voice" },
    ];
    const binders = deckBinders([ring, boltFoil, boltPaper, atraxa], refs, [
      { id: "d1", name: "Burn" },
      { id: "d2", name: "Squirrels" },
      { id: "d3", name: "Atraxa" },
      { id: "d4", name: "Empty" },
    ]);

    expect(binders.map((binder) => binder.name)).toEqual(["Atraxa", "Burn", "Empty", "Squirrels"]);
    expect(binders[0]!.groups.map((group) => group.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(binders[0]!.groups[0]!.piles.map((pile) => pile.id)).toEqual(["atraxa"]);
    expect(binders[1]!.groups.map((group) => group.name)).toEqual(["Lightning Bolt", "Sol Ring"]);
    expect(binders[2]!.groups).toEqual([]);
    expect(binders[3]!.groups.map((group) => group.name)).toEqual(["Lightning Bolt"]);
    expect(binders[1]!.groups[0]!.piles.map((pile) => pile.id)).toEqual(["foil", "paper"]);
  });
});
