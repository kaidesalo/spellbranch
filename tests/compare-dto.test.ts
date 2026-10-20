import { describe, expect, it } from "vitest";
import { toCompareSide } from "@/lib/compare-dto";
import type { DeckWithMeta } from "@/lib/types";

// Review M1 (defence in depth): CompareView is a client component, so its
// props are serialized into the page. It gets only what it renders.
describe("toCompareSide", () => {
  it("keeps only rendered fields: no notes, branches, source or owner ids", () => {
    const deck: DeckWithMeta = {
      id: "d1", ownerId: "owner-1", name: "Deck", format: "modern", notes: "SECRET-NOTES",
      visibility: "public", allowForks: true, forkedFromId: null, preferredBranchId: "b1",
      createdAt: "t", updatedAt: "t",
      owner: { id: "owner-1", username: "ann", displayName: "Ann", avatarUrl: null },
      cardCount: 2, forkCount: 1,
      branches: [{
        id: "b1", ownerId: "o2", name: "HIDDEN-BRANCH", format: "modern", notes: "BRANCH-NOTES",
        visibility: "private", allowForks: false, forkedFromId: "d1", preferredBranchId: null,
        createdAt: "t", updatedAt: "t",
      }],
      sourceDeck: null,
      cards: [{
        id: "c1", deckId: "d1", scryfallId: "s1", cardName: "Sol Ring", imageUri: null, manaCost: "{1}",
        typeLine: "Artifact", colors: [], oracleText: "ORACLE", quantity: 2, createdAt: "t",
      }],
    };
    const side = toCompareSide(deck);
    expect(side).toEqual({
      id: "d1", name: "Deck", format: "modern", cardCount: 2, ownerUsername: "ann",
      cards: [{ scryfallId: "s1", cardName: "Sol Ring", imageUri: null, manaCost: "{1}", typeLine: "Artifact", quantity: 2 }],
    });
    expect(JSON.stringify(side)).not.toMatch(/SECRET|HIDDEN|BRANCH-NOTES|owner-1|ORACLE/);
  });
});
