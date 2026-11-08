import { describe, expect, it } from "vitest";
import { branchSwitcherModel, type BranchSwitcherDeck } from "@/lib/branch-switcher";
import { defaultBranchName } from "@/lib/fork-name";
import { LIMITS } from "@/lib/data/limits";

const deck = (over: Partial<BranchSwitcherDeck>): BranchSwitcherDeck => ({
  id: "source",
  name: "Wretched Ranks",
  forkedFromId: null,
  preferredBranchId: null,
  owner: { username: "kaide" },
  ...over,
});

describe("defaultBranchName", () => {
  it("matches the automatic (branch) suffix when it fits", () => {
    expect(defaultBranchName("Wretched Ranks")).toBe("Wretched Ranks (branch)");
  });

  it("shortens the source name so the default still fits the deck-name limit", () => {
    expect(defaultBranchName("n".repeat(LIMITS.deckName))).toHaveLength(LIMITS.deckName);
    expect(defaultBranchName("n".repeat(LIMITS.deckName)).endsWith(" (branch)")).toBe(true);
    expect(defaultBranchName("n".repeat(71))).toBe(`${"n".repeat(71)} (branch)`);
  });
});

describe("branchSwitcherModel", () => {
  const branch = { id: "fork", name: "Wretched Ranks (branch)", owner: { username: "vulpibyte" } };
  const sibling = { id: "sib", name: "A sibling", owner: { username: "carol_u" } };

  it("is absent on a source deck with no visible branches", () => {
    expect(branchSwitcherModel(deck({}))).toBeNull();
  });

  it("puts the source first, then visible branches, on the source page", () => {
    const model = branchSwitcherModel(deck({
      preferredBranchId: "hidden",
      branches: [branch, sibling],
    }));
    expect(model?.options.map((o) => [o.id, o.role, o.preferred, o.diffHref])).toEqual([
      ["source", "source", false, null],
      ["sib", "branch", false, "/decks/source/compare?branch=sib"],
      ["fork", "branch", false, "/decks/source/compare?branch=fork"],
    ]);
    expect(model?.diffHref).toBe("/decks/source/compare?branch=sib");
    expect(JSON.stringify(model)).not.toContain("hidden");
  });

  it("marks a preferred branch only when that branch is visible", () => {
    const model = branchSwitcherModel(deck({
      preferredBranchId: "fork",
      branches: [branch],
    }));
    expect(model?.options.find((o) => o.id === "fork")?.preferred).toBe(true);
    expect(model?.diffHref).toBe("/decks/source/compare?branch=fork");
  });

  it("on a fork page lists the source and visible siblings", () => {
    const model = branchSwitcherModel(deck({
      id: "fork",
      name: branch.name,
      forkedFromId: "source",
      owner: { username: "vulpibyte" },
      sourceDeck: {
        id: "source",
        name: "Wretched Ranks",
        preferredBranchId: "sib",
        owner: { username: "kaide" },
      },
      sourceBranches: [branch, sibling],
    }));
    expect(model?.options.map((o) => [o.id, o.username, o.preferred])).toEqual([
      ["source", "kaide", false],
      ["sib", "carol_u", true],
      ["fork", "vulpibyte", false],
    ]);
    expect(model?.diffHref).toBe("/decks/source/compare?branch=fork");
  });

  it("drops the source and every diff link when the source is hidden", () => {
    const model = branchSwitcherModel(deck({
      id: "fork",
      name: branch.name,
      forkedFromId: "source",
      sourceDeck: null,
      sourceBranches: [branch, sibling],
    }));
    expect(model?.options.map((o) => o.id)).toEqual(["sib", "fork"]);
    expect(model?.options.every((o) => o.diffHref === null)).toBe(true);
    expect(model?.diffHref).toBeNull();
    expect(JSON.stringify(model)).not.toContain("source");
    expect(JSON.stringify(model)).not.toContain("compare");
  });
});
