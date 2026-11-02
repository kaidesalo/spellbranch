import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  type ZoomCard,
  largeScryfallImage,
  zoomCardFromSaved,
  zoomCardFromScryfall,
} from "@/lib/card-zoom";
import type { CompareSide } from "@/lib/compare-dto";
import type { DeckCard, DeckCommander } from "@/lib/types";

// Click to zoom: one CardZoom button per card in deck rows, compare and the
// commander slot. The lightbox itself only mounts on open, so these render
// tests check the triggers: a real <button>, and never wrapping the row's
// -/+, quantity or trash controls.

vi.mock("@/lib/actions/decks", () => ({
  updateCardQuantityAction: vi.fn(async () => ({ success: true })),
  setCommanderAction: vi.fn(async () => ({ success: true })),
  setPreferredBranchAction: vi.fn(async () => ({ success: true })),
}));

const { CardZoom } = await import("@/components/cards/card-zoom");
const { DeckList } = await import("@/components/decks/deck-list");
const { CompareView } = await import("@/components/decks/compare-view");
const { CommanderSlot } = await import("@/components/decks/commander-slot");

const NORMAL = "https://cards.scryfall.io/normal/front/a/b/ab12.jpg?1700000000";
const LARGE = "https://cards.scryfall.io/large/front/a/b/ab12.jpg?1700000000";

/** The opening tag through the first </button> after it. */
function buttonByLabel(html: string, label: string): string {
  const start = html.search(new RegExp(`<button[^>]*aria-label="${label}"`));
  expect(start, `button "${label}"`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</button>", start) + "</button>".length);
}

describe("card zoom images", () => {
  it("points saved Scryfall images at the large size", () => {
    expect(largeScryfallImage(NORMAL)).toBe(LARGE);
    expect(largeScryfallImage(NORMAL.replace("/normal/", "/small/"))).toBe(LARGE);
    expect(largeScryfallImage(LARGE)).toBe(LARGE);
    // Not a sized Scryfall card image: left alone.
    expect(largeScryfallImage("https://example.com/normal/x.jpg")).toBe(
      "https://example.com/normal/x.jpg",
    );
  });

  it("a saved card gets the large image with the saved one as fallback", () => {
    expect(zoomCardFromSaved("Sol Ring", NORMAL)).toEqual({
      name: "Sol Ring",
      faces: [{ name: "Sol Ring", src: LARGE, fallbackSrc: NORMAL }],
    });
    expect(zoomCardFromSaved("Sol Ring", null)).toBeNull();
  });

  it("a Scryfall card prefers large, then png", () => {
    expect(
      zoomCardFromScryfall({
        name: "Sol Ring",
        image_uris: { normal: "n.jpg", large: "l.jpg", png: "p.png" },
      })?.faces,
    ).toEqual([{ name: "Sol Ring", src: "l.jpg", fallbackSrc: "n.jpg" }]);
    expect(
      zoomCardFromScryfall({ name: "Sol Ring", image_uris: { png: "p.png" } })?.faces,
    ).toEqual([{ name: "Sol Ring", src: "p.png", fallbackSrc: null }]);
  });

  it("a double-faced card gets one face per card_faces image", () => {
    const zoom = zoomCardFromScryfall({
      name: "Delver of Secrets // Insectile Aberration",
      card_faces: [
        { name: "Delver of Secrets", image_uris: { large: "front.jpg" } },
        { name: "Insectile Aberration", image_uris: { large: "back.jpg" } },
      ],
    });
    expect(zoom?.faces.map((f) => [f.name, f.src])).toEqual([
      ["Delver of Secrets", "front.jpg"],
      ["Insectile Aberration", "back.jpg"],
    ]);
  });

  it("split and adventure cards (top-level image) stay one face", () => {
    const zoom = zoomCardFromScryfall({
      name: "Fire // Ice",
      image_uris: { large: "fire-ice.jpg" },
      card_faces: [{ name: "Fire" }, { name: "Ice" }],
    });
    expect(zoom?.faces).toHaveLength(1);
  });

  it("no image anywhere means nothing to zoom", () => {
    expect(zoomCardFromScryfall({ name: "Mystery" })).toBeNull();
  });
});

// Children go as createElement's third argument (react/no-children-prop).
const renderZoom = (card: ZoomCard | null) =>
  renderToStaticMarkup(
    createElement(CardZoom, { card } as ComponentProps<typeof CardZoom>, "Sol Ring"),
  );

describe("CardZoom trigger", () => {
  it("is a real button labelled by the card name", () => {
    const html = renderZoom(zoomCardFromSaved("Sol Ring", NORMAL));
    const button = buttonByLabel(html, "Sol Ring, view larger image");
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain(">Sol Ring</button>");
  });

  it("without an image it renders the children with no button", () => {
    const html = renderZoom(null);
    expect(html).toBe("Sol Ring");
  });
});

const solRing = {
  id: "c0000000-0000-4000-8000-000000000001",
  deckId: "d0000000-0000-4000-8000-000000000001",
  scryfallId: "s-sol-ring",
  cardName: "Sol Ring",
  imageUri: NORMAL,
  manaCost: "{1}",
  typeLine: "Artifact",
  colors: [],
  oracleText: null,
  quantity: 1,
  createdAt: "2026-11-01T12:00:00.000Z",
} as DeckCard;

describe("where cards zoom", () => {
  it("deck rows: thumbnail and name open the zoom, -/+, quantity and trash don't", () => {
    const html = renderToStaticMarkup(
      createElement(DeckList, { deckId: solRing.deckId, cards: [solRing], canEdit: true }),
    );
    const trigger = buttonByLabel(html, "Sol Ring, view larger image");
    expect(trigger).toContain(`src="${NORMAL.replace(/&/g, "&amp;")}"`);
    expect(trigger).toContain("Sol Ring");
    for (const control of ["Decrease Sol Ring", "Increase Sol Ring", "Remove Sol Ring", "Quantity of Sol Ring"]) {
      expect(html).toContain(`aria-label="${control}"`);
      expect(trigger).not.toContain(control);
    }
    expect(trigger).not.toContain("<input");
  });

  it("deck rows without an image keep the plain name", () => {
    const html = renderToStaticMarkup(
      createElement(DeckList, {
        deckId: solRing.deckId,
        cards: [{ ...solRing, imageUri: null }],
        canEdit: true,
      }),
    );
    expect(html).not.toContain("view larger image");
  });

  it("compare: changed cards, replacements and commanders open the zoom", () => {
    const side = (over: Partial<CompareSide>): CompareSide => ({
      id: "d1",
      name: "Deck",
      format: "commander",
      cardCount: 1,
      ownerUsername: null,
      commander: null,
      cards: [],
      ...over,
    });
    const card = (name: string) => ({
      scryfallId: `s-${name}`,
      cardName: name,
      imageUri: NORMAL,
      manaCost: null,
      typeLine: "Artifact",
      quantity: 1,
    });
    const html = renderToStaticMarkup(
      createElement(CompareView, {
        source: side({
          cards: [card("Mind Stone")],
          commander: { scryfallId: "c1", cardName: "Atraxa", typeLine: "Legendary Creature", imageUri: NORMAL },
        }),
        branch: side({
          id: "d2",
          cards: [card("Arcane Signet")],
          commander: { scryfallId: "c2", cardName: "Ghave", typeLine: "Legendary Creature", imageUri: NORMAL },
        }),
        isPreferred: false,
        canSetPreferred: false,
      }),
    );
    for (const name of ["Mind Stone", "Arcane Signet", "Atraxa", "Ghave"]) {
      buttonByLabel(html, `${name}, view larger image`);
    }
  });

  it("commander slot: name and card image open the zoom", () => {
    const commander: DeckCommander = {
      scryfallId: "c1",
      cardName: "Atraxa, Praetors' Voice",
      typeLine: "Legendary Creature — Phyrexian Angel Horror",
      manaCost: "{G}{W}{U}{B}",
      imageUri: NORMAL,
      artUri: null,
      colorIdentity: ["W", "U", "B", "G"],
    };
    const html = renderToStaticMarkup(
      createElement(CommanderSlot, { deckId: "d1", commander, canEdit: true, alsoInDeckList: false, deckColors: null }),
    );
    const label = "Atraxa, Praetors&#x27; Voice, view larger image";
    expect(html.split(`aria-label="${label}"`)).toHaveLength(3);
    // Change / Clear stay their own buttons.
    expect(buttonByLabel(html, label)).not.toContain("Change commander");
  });
});
