// @vitest-environment happy-dom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BranchSwitcher } from "@/components/decks/branch-switcher";
import { branchSwitcherModel, type BranchSwitcherDeck } from "@/lib/branch-switcher";

const source: BranchSwitcherDeck = {
  id: "source",
  name: "Live and Burn",
  forkedFromId: null,
  preferredBranchId: null,
  owner: { username: "bob" },
  copyLinks: [{
    id: "copy",
    name: "Live and Burn (copy)",
    username: "carol",
    role: "copy",
    visible: true,
  }],
};

const copy: BranchSwitcherDeck = {
  id: "copy",
  name: "Live and Burn (copy)",
  forkedFromId: null,
  preferredBranchId: null,
  owner: { username: "carol" },
  copyLinks: [{
    id: "source",
    name: "Live and Burn",
    username: "bob",
    role: "original",
    visible: true,
  }],
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function openMenu(deck: BranchSwitcherDeck) {
  const model = branchSwitcherModel(deck);
  render(
    createElement(BranchSwitcher, {
      currentId: deck.id,
      options: model!.options,
      diffHref: model!.diffHref,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Branches/ }));
}

describe("branch list copy marks", () => {
  it("marks the copier's deck as a copy on the source owner's list", async () => {
    openMenu(source);
    expect(await screen.findByText("Copy by @carol")).toBeTruthy();
    expect(screen.getByText("Copy")).toBeTruthy();
    const row = screen.getByRole("menuitem", { name: /Copy by @carol/ });
    expect(row.getAttribute("href")).toBe("/decks/copy");
  });

  it("does not link a copy the viewer cannot open", async () => {
    openMenu({
      ...source,
      copyLinks: [{ ...source.copyLinks![0]!, visible: false }],
    });
    const row = await screen.findByRole("menuitem", { name: /Live and Burn \(copy\)/ });
    expect(row.getAttribute("href")).toBeNull();
    expect(screen.getByText("Copy by @carol")).toBeTruthy();
  });

  it("marks the source as the original on the copier's list", async () => {
    openMenu(copy);
    expect(await screen.findByText("Original")).toBeTruthy();
    const row = screen.getByRole("menuitem", { name: /^Live and Burn @bob/ });
    expect(row.getAttribute("href")).toBe("/decks/source");
  });
});
