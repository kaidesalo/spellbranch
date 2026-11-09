import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getPrimaryType, groupCardsByType } from "@/lib/card-types";
import type { DeckCard } from "@/lib/types";

// Deck list piles come from getPrimaryType. Artifact lands ("Artifact Land")
// are lands for that grouping: land pile and land count. Other artifacts stay
// where they were.

vi.mock("@/lib/actions/decks", () => ({
  updateCardQuantityAction: vi.fn(async () => ({ success: true })),
  removeCardFromDeckAction: vi.fn(async () => ({ success: true })),
}));

const { DeckList } = await import("@/components/decks/deck-list");

const DECK = "d0000000-0000-4000-8000-000000000001";

function card(name: string, typeLine: string, quantity = 1): DeckCard {
  return {
    id: name,
    deckId: DECK,
    scryfallId: name,
    cardName: name,
    imageUri: null,
    manaCost: null,
    typeLine,
    colors: [],
    oracleText: null,
    quantity,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
}

describe("getPrimaryType", () => {
  it.each([
    ["Darksteel Citadel", "Artifact Land"],
    ["Seat of the Synod", "Artifact Land"],
    ["Ancient Den", "Artifact Land"],
    ["Tree of Tales", "Artifact Land"],
    ["Scene of the Crime", "Artifact Land — Clue"],
  ])("classifies %s (%s) as a land", (_name, typeLine) => {
    expect(getPrimaryType(typeLine)).toBe("Land");
  });

  it("still classifies a regular land as a land", () => {
    expect(getPrimaryType("Basic Land — Forest")).toBe("Land");
    expect(getPrimaryType("Land")).toBe("Land");
  });

  it("still classifies a regular artifact as an artifact", () => {
    expect(getPrimaryType("Artifact")).toBe("Artifact");
    expect(getPrimaryType("Artifact — Equipment")).toBe("Artifact");
  });

  it("still classifies a non-land artifact creature as a creature", () => {
    expect(getPrimaryType("Artifact Creature — Golem")).toBe("Creature");
    expect(getPrimaryType("Artifact Creature — Thopter")).toBe("Creature");
    // Golden Guardian // Gold-Forge Garrison: artifact creature in front, land behind.
    expect(getPrimaryType("Artifact Creature — Golem // Land")).toBe("Creature");
  });

  it("does not treat a transforming artifact // land as an artifact land", () => {
    // Treasure Map // Treasure Cove. The land is the back face.
    expect(getPrimaryType("Artifact // Land")).toBe("Artifact");
  });
});

describe("groupCardsByType", () => {
  const cards = [
    card("Darksteel Citadel", "Artifact Land", 1),
    card("Seat of the Synod", "Artifact Land", 1),
    card("Ancient Den", "Artifact Land", 2),
    card("Tree of Tales", "Artifact Land", 1),
    card("Forest", "Basic Land — Forest", 4),
    card("Sol Ring", "Artifact", 1),
    card("Swiftfoot Boots", "Artifact — Equipment", 1),
    card("Solemn Simulacrum", "Artifact Creature — Golem", 1),
  ];

  const groups = groupCardsByType(cards);
  const byType = Object.fromEntries(groups.map((group) => [group.type, group]));

  it("puts artifact lands in the land pile, with the land count", () => {
    expect(byType.Land.cards.map((c) => c.cardName)).toEqual([
      "Ancient Den",
      "Darksteel Citadel",
      "Forest",
      "Seat of the Synod",
      "Tree of Tales",
    ]);
    // 1 + 1 + 2 + 1 + 4
    expect(byType.Land.count).toBe(9);
  });

  it("keeps regular artifacts in the artifact pile", () => {
    expect(byType.Artifact.cards.map((c) => c.cardName)).toEqual([
      "Sol Ring",
      "Swiftfoot Boots",
    ]);
    expect(byType.Artifact.count).toBe(2);
  });

  it("keeps artifact creatures in the creature pile", () => {
    expect(byType.Creature.cards.map((c) => c.cardName)).toEqual(["Solemn Simulacrum"]);
    expect(byType.Creature.count).toBe(1);
  });
});

describe("DeckList piles", () => {
  it("shows Darksteel Citadel and Seat of the Synod under Land, not Artifact", () => {
    const html = renderToStaticMarkup(
      createElement(DeckList, {
        deckId: DECK,
        canEdit: false,
        cards: [
          card("Darksteel Citadel", "Artifact Land", 1),
          card("Seat of the Synod", "Artifact Land", 1),
          card("Ancient Den", "Artifact Land", 1),
          card("Tree of Tales", "Artifact Land", 1),
          card("Forest", "Basic Land — Forest", 2),
          card("Sol Ring", "Artifact", 1),
          card("Solemn Simulacrum", "Artifact Creature — Golem", 1),
        ],
      }),
    );

    // Pile order is Creature, then Artifact, then Land.
    const creatureAt = html.indexOf(">Creature<");
    const artifactAt = html.indexOf(">Artifact<");
    const landAt = html.indexOf(">Land<");
    expect(creatureAt).toBeGreaterThan(-1);
    expect(artifactAt).toBeGreaterThan(creatureAt);
    expect(landAt).toBeGreaterThan(artifactAt);

    const creatureSection = html.slice(creatureAt, artifactAt);
    const artifactSection = html.slice(artifactAt, landAt);
    const landSection = html.slice(landAt);

    for (const name of ["Darksteel Citadel", "Seat of the Synod", "Ancient Den", "Tree of Tales", "Forest"]) {
      expect(landSection, name).toContain(name);
      expect(artifactSection, name).not.toContain(name);
    }
    expect(landSection).toContain(">6<");
    expect(artifactSection).toContain("Sol Ring");
    expect(artifactSection).not.toContain("Darksteel Citadel");
    expect(artifactSection).not.toContain("Seat of the Synod");
    expect(creatureSection).toContain("Solemn Simulacrum");
    expect(creatureSection).not.toContain("Darksteel Citadel");
  });
});
