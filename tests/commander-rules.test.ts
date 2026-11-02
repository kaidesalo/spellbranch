import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  commanderFromScryfall,
  deckCountLabel,
  isLegendaryCreatureCard,
  isLegendaryCreatureTypeLine,
  normalizeColorIdentity,
} from "@/lib/commander";
import { compareCommanders } from "@/lib/compare-dto";
import { LIMITS } from "@/lib/data/limits";
import { buildSearchQuery, type ScryfallCard } from "@/lib/scryfall/client";

// Fake card data only. Same cases as supabase/tests/deck_commander.sql.
const ID = "11111111-2222-4333-8444-555555555555";
const legend = (over: Partial<ScryfallCard> = {}): ScryfallCard => ({
  id: ID,
  name: "Test Legend",
  mana_cost: "{1}{G}{U}",
  type_line: "Legendary Creature — Elf Druid",
  color_identity: ["U", "G"],
  image_uris: {
    normal: `https://cards.scryfall.io/normal/front/1/1/${ID}.jpg`,
    art_crop: `https://cards.scryfall.io/art_crop/front/1/1/${ID}.jpg`,
  },
  ...over,
});

describe("isLegendaryCreatureTypeLine", () => {
  const yes = [
    "Legendary Creature — Human Wizard",
    "Legendary Enchantment Creature — God",
    "Legendary Artifact Creature — Golem",
    "Legendary Snow Creature — Giant",
    "Legendary Creature — Human // Legendary Planeswalker — Nissa",
    "Legendary Creature",
  ];
  const no = [
    "Legendary Artifact",
    "Creature — Elf Druid",
    "Legendary Planeswalker — Teferi",
    "Legendary Enchantment — Background",
    "Legendary Planeswalker — Nissa // Legendary Creature — Elf",
    "Artifact — Equipment Legendary Creature",
    "legendary creature — elf",
    "LegendaryCreature — Elf",
    "Legendary Creatures",
    "",
  ];
  for (const t of yes) it(`accepts "${t}"`, () => expect(isLegendaryCreatureTypeLine(t)).toBe(true));
  for (const t of no) it(`rejects "${t}"`, () => expect(isLegendaryCreatureTypeLine(t)).toBe(false));
  it("rejects non-strings", () => {
    for (const v of [null, undefined, 42, {}] as unknown[]) {
      expect(isLegendaryCreatureTypeLine(v as string)).toBe(false);
    }
  });
});

describe("commanderFromScryfall", () => {
  it("builds the stored commander from a legendary creature", () => {
    expect(commanderFromScryfall(legend())).toEqual({
      scryfallId: ID,
      cardName: "Test Legend",
      typeLine: "Legendary Creature — Elf Druid",
      manaCost: "{1}{G}{U}",
      imageUri: `https://cards.scryfall.io/normal/front/1/1/${ID}.jpg`,
      artUri: `https://cards.scryfall.io/art_crop/front/1/1/${ID}.jpg`,
      colorIdentity: ["U", "G"],
    });
  });

  it("uses the front face of a double-faced card (type, art)", () => {
    const card = legend({
      type_line: "Legendary Creature — Human // Legendary Planeswalker — Nissa",
      image_uris: undefined,
      card_faces: [
        { type_line: "Legendary Creature — Human", image_uris: { normal: "https://cards.scryfall.io/n/f.jpg", art_crop: "https://cards.scryfall.io/a/f.jpg" } },
        { type_line: "Legendary Planeswalker — Nissa", image_uris: { normal: "https://cards.scryfall.io/n/b.jpg" } },
      ],
    });
    expect(commanderFromScryfall(card)).toMatchObject({
      typeLine: "Legendary Creature — Human",
      artUri: "https://cards.scryfall.io/a/f.jpg",
    });
  });

  it("rejects cards that can't lead a deck (out of scope included)", () => {
    for (const type_line of ["Legendary Artifact", "Creature — Elf", "Legendary Planeswalker — Teferi", "Legendary Enchantment — Background"]) {
      expect(commanderFromScryfall(legend({ type_line }))).toBeNull();
    }
    // Back face only.
    expect(commanderFromScryfall(legend({
      type_line: "Legendary Planeswalker — X // Legendary Creature — Y",
      card_faces: [{ type_line: "Legendary Planeswalker — X" }, { type_line: "Legendary Creature — Y" }],
    }))).toBeNull();
  });

  it("rejects ids that aren't UUIDs and over-long fields", () => {
    expect(commanderFromScryfall(legend({ id: "not-a-uuid" }))).toBeNull();
    expect(commanderFromScryfall(legend({ name: "" }))).toBeNull();
    expect(commanderFromScryfall(legend({ name: "n".repeat(LIMITS.cardName + 1) }))).toBeNull();
    expect(commanderFromScryfall(legend({ type_line: `Legendary Creature — ${"x".repeat(LIMITS.typeLine)}` }))).toBeNull();
    expect(commanderFromScryfall(legend({ mana_cost: "{1}".repeat(40) }))).toBeNull();
  });

  it("lowercases the id, drops non-Scryfall images and unknown colors", () => {
    const c = commanderFromScryfall(legend({
      id: ID.toUpperCase(),
      color_identity: ["G", "X", "W", "G"],
      image_uris: { normal: "https://evil.example/x.png", art_crop: "javascript:alert(1)" },
    }));
    expect(c).toMatchObject({ scryfallId: ID, imageUri: null, artUri: null, colorIdentity: ["W", "G"] });
  });
});

describe("helpers", () => {
  it("normalizeColorIdentity keeps WUBRG order", () => {
    expect(normalizeColorIdentity(["G", "B", "W", "U", "R"])).toEqual(["W", "U", "B", "R", "G"]);
    expect(normalizeColorIdentity(undefined)).toEqual([]);
  });

  it("deckCountLabel counts the commander separately from the deck list", () => {
    expect(deckCountLabel(99, true)).toBe("1 commander + 99 cards");
    expect(deckCountLabel(1, true)).toBe("1 commander + 1 card");
    expect(deckCountLabel(60, false)).toBe("60 cards");
  });

  it("isLegendaryCreatureCard reads the front face", () => {
    expect(isLegendaryCreatureCard(legend())).toBe(true);
    expect(isLegendaryCreatureCard(legend({ type_line: "Legendary Artifact" }))).toBe(false);
  });

  it("commander search adds the legendary creature filter around the user's query", () => {
    expect(buildSearchQuery("atraxa", "commander")).toBe('(name:"atraxa" OR atraxa) t:legendary t:creature');
    expect(buildSearchQuery("c:g", "commander")).toBe("(c:g) t:legendary t:creature");
    expect(buildSearchQuery("atraxa")).toBe('name:"atraxa" OR atraxa');
  });

  it("compareCommanders", () => {
    const a = { scryfallId: "a", cardName: "A", typeLine: "Legendary Creature" };
    const b = { scryfallId: "b", cardName: "B", typeLine: "Legendary Creature" };
    expect(compareCommanders(null, null)).toBe("none");
    expect(compareCommanders(a, a)).toBe("same");
    expect(compareCommanders(a, b)).toBe("changed");
    expect(compareCommanders(null, b)).toBe("added");
    expect(compareCommanders(a, null)).toBe("removed");
  });
});

describe("migration 006 agrees with the app", () => {
  const m006 = readFileSync(path.resolve(__dirname, "../supabase/migrations/006_deck_commander.sql"), "utf8");

  it("uses the app length limits", () => {
    expect(m006).toContain(`char_length(commander_name) between 1 and ${LIMITS.cardName}`);
    expect(m006).toContain(`char_length(commander_type_line) <= ${LIMITS.typeLine}`);
    expect(m006).toContain(`char_length(commander_mana_cost) <= ${LIMITS.manaCost}`);
    expect(m006).toContain(`char_length(commander_image_uri) <= ${LIMITS.imageUri}`);
    expect(m006).toContain(`char_length(commander_art_uri) <= ${LIMITS.imageUri}`);
  });

  it("uses the same type-line rule as isLegendaryCreatureTypeLine", () => {
    expect(m006).toContain(`split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\\s)Legendary(\\s|$)'`);
    expect(m006).toContain(`split_part(split_part(commander_type_line, '//', 1), '—', 1) ~ '(^|\\s)Creature(\\s|$)'`);
  });

  it("ties the commander to the Commander format and copies it on fork", () => {
    expect(m006).toContain("commander_scryfall_id is null or format = 'commander'");
    expect(m006).toMatch(/create or replace function public\.fork_deck[\s\S]*src\.commander_scryfall_id/);
    expect(m006).toContain("grant execute on function public.fork_deck(uuid) to authenticated;");
    expect(m006).toContain("revoke execute on function public.fork_deck(uuid) from public, anon;");
  });

  it("adds no policies (the deck policies already cover the columns)", () => {
    expect(m006).not.toMatch(/create policy/i);
  });
});
