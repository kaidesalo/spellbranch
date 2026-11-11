import { describe, expect, it } from "vitest";
import { createMockClient, eqValue, ok, type Call } from "./helpers/supabase-mock";
import { createSupabaseRepository } from "@/lib/data/supabase";

const ALICE = "a0000000-0000-4000-8000-000000000001";
const DECK = "d0000000-0000-4000-8000-000000000001";
const SOURCE = "c0000000-0000-4000-8000-000000000001";
const TARGET = "c0000000-0000-4000-8000-000000000002";
const OLD = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const T = "2026-11-11T00:00:00.000Z";

const deckRow = {
  id: DECK,
  owner_id: ALICE,
  name: "Deck",
  format: "modern",
  notes: "",
  visibility: "private",
  allow_forks: false,
  forked_from_id: null,
  preferred_branch_id: null,
  colors: ["R"],
  created_at: T,
  updated_at: T,
};

const printing = {
  scryfallId: NEXT,
  cardName: "Lightning Bolt",
  imageUri: "https://cards.scryfall.io/normal/front/a/b/new.jpg",
  manaCost: "{R}",
  typeLine: "Instant",
  colors: ["R"],
  colorIdentity: ["R"],
  oracleText: "Lightning Bolt deals 3 damage to any target.",
};

function card(id: string, scryfallId: string, quantity: number) {
  return {
    id,
    scryfall_id: scryfallId,
    quantity,
    colors: ["R"],
    color_identity: ["R"],
    board: "side",
    category_id: null,
    for_trade: false,
    condition: null,
    finish: "nonfoil",
  };
}

describe("printing merge is one RPC", () => {
  it("merges a deck printing with merge_deck_card_printing", async () => {
    const respond = (call: Call) => {
      if (call.op === "rpc" && call.fn === "merge_deck_card_printing") return ok(null);
      if (call.table === "decks" && call.op === "select") return ok(deckRow);
      if (call.table === "decks" && call.op === "update") return ok(null);
      if (call.table === "deck_cards" && call.op === "select") {
        if (eqValue(call, "id") === SOURCE) return ok(card(SOURCE, OLD, 2));
        if (eqValue(call, "scryfall_id") === NEXT) return ok(card(TARGET, NEXT, 3));
      }
      return undefined;
    };
    const mock = createMockClient(respond);
    const repo = createSupabaseRepository(mock.factory);
    await repo.changeDeckPrinting(ALICE, DECK, SOURCE, printing);
    const merges = mock.calls.filter((call) => call.fn === "merge_deck_card_printing");
    expect(merges).toHaveLength(1);
    expect(merges[0]?.args).toEqual({ target: TARGET, source: SOURCE });
    expect(mock.calls.some((call) => call.table === "deck_cards" && call.op === "update")).toBe(false);
    expect(mock.calls.some((call) => call.table === "deck_cards" && call.op === "delete")).toBe(false);
  });

  it("merges a collection printing with merge_collection_card_printing", async () => {
    const respond = (call: Call) => {
      if (call.op === "rpc" && call.fn === "merge_collection_card_printing") return ok(null);
      if (call.table === "collection_cards" && call.op === "select") {
        if (eqValue(call, "id") === SOURCE) {
          return ok({ ...card(SOURCE, OLD, 4), for_trade: true, condition: "LP", finish: "nonfoil" });
        }
        if (eqValue(call, "scryfall_id") === NEXT) {
          return ok({ ...card(TARGET, NEXT, 5), for_trade: false, condition: null, finish: "foil" });
        }
      }
      return undefined;
    };
    const mock = createMockClient(respond);
    const repo = createSupabaseRepository(mock.factory);
    await repo.changeCollectionPrinting(ALICE, SOURCE, printing, "foil");
    const merges = mock.calls.filter((call) => call.fn === "merge_collection_card_printing");
    expect(merges).toHaveLength(1);
    expect(merges[0]?.args).toEqual({ target: TARGET, source: SOURCE });
    expect(mock.calls.some((call) => call.table === "collection_cards" && (call.op === "update" || call.op === "delete"))).toBe(
      false,
    );
  });
});
