import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/data/limits";

// Review L2: the zod limits (src/lib/data/limits.ts) and the database CHECKs
// (003_length_limits.sql) must agree, including the L3 trim statements.
const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const m003 = read("supabase/migrations/003_length_limits.sql");

describe("length limits agree between the app and the database", () => {
  const checks: [string, string][] = [
    ["bio", `char_length(bio) <= ${LIMITS.bio}`],
    ["deck name", `char_length(name) between 1 and ${LIMITS.deckName}`],
    ["deck notes", `char_length(notes) <= ${LIMITS.deckNotes}`],
    ["scryfall id", `char_length(scryfall_id) <= ${LIMITS.scryfallId}`],
    ["card name", `char_length(card_name) <= ${LIMITS.cardName}`],
    ["type line", `char_length(type_line) <= ${LIMITS.typeLine}`],
    ["mana cost", `char_length(mana_cost) <= ${LIMITS.manaCost}`],
    ["oracle text", `char_length(oracle_text) <= ${LIMITS.oracleText}`],
    ["image uri", `char_length(image_uri) <= ${LIMITS.imageUri}`],
    ["colors", `cardinality(colors) <= ${LIMITS.colors}`],
  ];
  for (const [label, sql] of checks) {
    it(`${label}: CHECK uses the app limit`, () => {
      expect(m003).toContain(sql);
    });
  }

  it("L3 trims use the same numbers", () => {
    expect(m003).toContain(`left(bio, ${LIMITS.bio})`);
    expect(m003).toContain(`left(name, ${LIMITS.deckName})`);
    expect(m003).toContain(`left(notes, ${LIMITS.deckNotes})`);
    expect(m003).toContain(`left(card_name, ${LIMITS.cardName})`);
    expect(m003).toContain(`left(type_line, ${LIMITS.typeLine})`);
    expect(m003).toContain(`left(mana_cost, ${LIMITS.manaCost})`);
    expect(m003).toContain(`left(oracle_text, ${LIMITS.oracleText})`);
    // Over-long Scryfall ids are deleted, never renamed (a derived new value
    // could collide with a planted row; Cipher re-review N1).
    expect(m003).toContain(`delete from public.deck_cards where char_length(scryfall_id) > ${LIMITS.scryfallId};`);
    expect(m003).toContain(`delete from public.favorite_cards where char_length(scryfall_id) > ${LIMITS.scryfallId};`);
    expect(m003).not.toMatch(/set\s+scryfall_id\s*=/i);
    expect(m003).toContain(`char_length(image_uri) > ${LIMITS.imageUri}`);
  });

  it("comment body limit matches 001", () => {
    expect(read("supabase/migrations/001_initial.sql")).toContain(
      `char_length(body) between 1 and ${LIMITS.commentBody}`,
    );
  });

  it("form maxLength attributes match", () => {
    const form = read("src/components/decks/deck-form.tsx");
    expect(form).toContain(`maxLength={${LIMITS.deckName}}`);
    expect(form).toContain(`maxLength={${LIMITS.deckNotes}}`);
    expect(read("src/components/comments/comment-section.tsx")).toContain(`maxLength={${LIMITS.commentBody}}`);
  });

  it("every constraint is dropped before it is added (idempotent)", () => {
    const added = [...m003.matchAll(/add constraint (\w+)/g)].map((x) => x[1]);
    const dropped = [...m003.matchAll(/drop constraint if exists (\w+)/g)].map((x) => x[1]);
    expect(added.length).toBeGreaterThan(0);
    expect(dropped.sort()).toEqual(added.sort());
  });
});
