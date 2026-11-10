import { describe, expect, it } from "vitest";
import { branchSwitcherModel, type BranchSwitcherDeck } from "@/lib/branch-switcher";
import { defaultBranchName, defaultCopyName, forkNameError } from "@/lib/fork-name";
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

describe("defaultCopyName", () => {
  it("matches the automatic (copy) suffix when it fits", () => {
    expect(defaultCopyName("Wretched Ranks")).toBe("Wretched Ranks (copy)");
  });

  it("shortens the source name so the default still fits the deck-name limit", () => {
    expect(defaultCopyName("n".repeat(LIMITS.deckName))).toHaveLength(LIMITS.deckName);
    expect(defaultCopyName("n".repeat(LIMITS.deckName)).endsWith(" (copy)")).toBe(true);
  });
});

describe("forkNameError", () => {
  it("trims, rejects an empty name, and keeps the deck-name limit", () => {
    expect(forkNameError("  Shadow test  ")).toBeNull();
    expect(forkNameError("   ")).toBe("Deck name is required");
    expect(forkNameError("")).toBe("Deck name is required");
    expect(forkNameError("n".repeat(LIMITS.deckName))).toBeNull();
    expect(forkNameError(`  ${"n".repeat(LIMITS.deckName)}  `)).toBeNull();
    expect(forkNameError("n".repeat(LIMITS.deckName + 1))).toBe(
      `Deck name must be at most ${LIMITS.deckName} characters`,
    );
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

  it("shows a copy on the source owner's branch list and the original on the copier's", () => {
    const onSource = branchSwitcherModel(deck({
      branches: [branch],
      copyLinks: [{
        id: "copy",
        name: "Wretched Ranks (copy)",
        username: "carol_u",
        role: "copy",
        visible: false,
      }],
    }));
    expect(onSource?.options.map((o) => [o.id, o.role, o.openHref === undefined ? "default" : o.openHref, o.diffHref])).toEqual([
      ["source", "source", "default", null],
      ["fork", "branch", "default", "/decks/source/compare?branch=fork"],
      ["copy", "copy", null, null],
    ]);

    const onCopy = branchSwitcherModel(deck({
      id: "copy",
      name: "Wretched Ranks (copy)",
      owner: { username: "carol_u" },
      copyLinks: [{
        id: "source",
        name: "Wretched Ranks",
        username: "kaide",
        role: "original",
        visible: true,
      }],
    }));
    expect(onCopy?.options.map((o) => [o.id, o.role, o.openHref, o.diffHref])).toEqual([
      ["copy", "source", undefined, null],
      ["source", "original", "/decks/source", "/decks/source/compare?branch=copy"],
    ]);
  });
});
