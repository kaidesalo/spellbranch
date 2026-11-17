// @vitest-environment happy-dom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckCommander } from "@/lib/types";

const ORACLE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CURRENT = "11111111-2222-4333-8444-555555555555";
const NEXT = "22222222-3333-4444-8555-666666666666";

const lookup = vi.hoisted(() => vi.fn(async () => ({ oracleId: ORACLE })));
const changePrinting = vi.hoisted(() => vi.fn(async () => ({ success: true })));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("next/image", () => ({
  default: (props: { alt?: string; src?: string }) => createElement("img", { alt: props.alt ?? "", src: props.src }),
}));
vi.mock("@/lib/actions/decks", () => ({
  setCommanderAction: vi.fn(async () => ({ success: true })),
  lookupCommanderOracleAction: lookup,
  changeCommanderPrintingAction: changePrinting,
}));

const { CommanderSlot } = await import("@/components/decks/commander-slot");

function commander(): DeckCommander {
  return {
    scryfallId: CURRENT,
    cardName: "Test Legend",
    typeLine: "Legendary Creature — Elf",
    manaCost: "{2}{G}",
    imageUri: "https://cards.scryfall.io/normal/old.jpg",
    artUri: null,
    colorIdentity: ["G"],
  };
}

const slot = (canEdit: boolean, card: DeckCommander | null = commander()) =>
  createElement(CommanderSlot, {
    deckId: "d0000000-0000-4000-8000-000000000001",
    commander: card,
    canEdit,
    alsoInDeckList: false,
    deckColors: ["G"],
  });

afterEach(() => {
  cleanup();
  lookup.mockClear();
  changePrinting.mockClear();
});

describe("commander printing control", () => {
  it("shows Change printing only when the viewer can edit a commander", () => {
    const owner = renderToStaticMarkup(slot(true));
    expect(owner).toContain('aria-label="Change printing of Test Legend"');
    expect(owner).toContain("min-h-11");

    const viewer = renderToStaticMarkup(slot(false));
    expect(viewer).not.toContain("Change printing");

    const empty = renderToStaticMarkup(slot(true, null));
    expect(empty).not.toContain("Change printing");
  });

  it("loads printings through the search proxy and saves the chosen one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const params = new URL(url, "http://localhost").searchParams;
        expect(params.get("q")).toBe(`oracleid:${ORACLE}`);
        expect(params.get("unique")).toBe("prints");
        return Response.json({
          cards: [
            {
              id: CURRENT,
              oracle_id: ORACLE,
              name: "Test Legend",
              set_name: "Bloomburrow",
              image_uris: { normal: "https://cards.scryfall.io/normal/old.jpg" },
            },
            {
              id: NEXT,
              oracle_id: ORACLE,
              name: "Test Legend",
              set_name: "The List",
              image_uris: { normal: "https://cards.scryfall.io/normal/next.jpg" },
            },
          ],
        });
      }),
    );
    render(slot(true));
    fireEvent.click(screen.getByRole("button", { name: "Change printing of Test Legend" }));
    fireEvent.click(await screen.findByRole("button", { name: "The List" }));
    await vi.waitFor(() =>
      expect(changePrinting).toHaveBeenCalledWith("d0000000-0000-4000-8000-000000000001", NEXT),
    );
    expect(lookup).toHaveBeenCalled();
  });
});
