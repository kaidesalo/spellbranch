import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { setRateLimitStoreForTests } from "@/lib/rate-limit";
import { MemoryStore } from "@/lib/rate-limit/memory-store";

const ME = "a0000000-0000-4000-8000-000000000001";
const DECK = "d0000000-0000-4000-8000-000000000001";
const ROW = "c0000000-0000-4000-8000-000000000001";
const OLD = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const changeDeckPrinting = vi.fn(async () => undefined);
const changeCollectionPrinting = vi.fn(async () => undefined);
const getDeckPermissions = vi.fn(async () => ({
  canEdit: true,
  canFork: false,
  canCopy: false,
  canComment: false,
}));
const getDeck = vi.fn(async () => ({
  id: DECK,
  ownerId: ME,
  cards: [{ id: ROW, scryfallId: OLD, cardName: "Lightning Bolt" }],
}));
const listMyCollection = vi.fn(async () => [
  { id: ROW, scryfallId: OLD, cardName: "Lightning Bolt", finish: "nonfoil", forTrade: true, quantity: 2 },
]);

let cards: Record<string, ScryfallCard | null>;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: ME, email: "me@example.test", username: "me_u", displayName: "Me" }),
}));
vi.mock("@/lib/data", async () => {
  const errors = await import("@/lib/data/errors");
  return {
    getRepository: () => ({
      changeDeckPrinting,
      changeCollectionPrinting,
      getDeckPermissions,
      getDeck,
      listMyCollection,
    }),
    userMessage: errors.userMessage,
  };
});
vi.mock("@/lib/scryfall/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/scryfall/client")>()),
  getScryfallCard: vi.fn(async (id: string) => cards[id] ?? null),
  listCardPrintings: vi.fn(async () => []),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { changeDeckPrintingAction, changeCollectionPrintingAction } = await import("@/lib/actions/printings");

const face = (id: string, oracle: string, finishes: string[]): ScryfallCard => ({
  id,
  oracle_id: oracle,
  name: "Lightning Bolt",
  mana_cost: "{R}",
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  finishes,
  image_uris: { normal: "https://cards.scryfall.io/normal/front/x/y/card.jpg" },
});

beforeEach(() => {
  vi.stubEnv("SPELLBRANCH_CLIENT_IP_HEADER", "x-real-ip");
  setRateLimitStoreForTests(new MemoryStore(() => 1_200_000_000_000));
  changeDeckPrinting.mockClear();
  changeCollectionPrinting.mockClear();
  getDeckPermissions.mockClear();
  cards = {
    [OLD]: face(OLD, "oracle-bolt", ["nonfoil", "foil"]),
    [NEXT]: face(NEXT, "oracle-bolt", ["nonfoil", "foil"]),
    [OTHER]: face(OTHER, "oracle-shock", ["nonfoil"]),
  };
});

describe("change printing actions", () => {
  it("refuses a printing of a different card and does not write", async () => {
    const result = await changeDeckPrintingAction(DECK, ROW, OTHER);
    expect(result.error).toMatch(/different card/);
    expect(changeDeckPrinting).not.toHaveBeenCalled();
  });

  it("refuses a collection finish the printing does not offer", async () => {
    const result = await changeCollectionPrintingAction(ROW, NEXT, "etched");
    expect(result.error).toMatch(/finish/);
    expect(changeCollectionPrinting).not.toHaveBeenCalled();
  });

  it("refuses a deck swap when the caller cannot edit", async () => {
    getDeckPermissions.mockResolvedValueOnce({ canEdit: false, canFork: false, canCopy: false, canComment: false });
    const result = await changeDeckPrintingAction(DECK, ROW, NEXT);
    expect(result.error).toMatch(/cannot edit/);
    expect(changeDeckPrinting).not.toHaveBeenCalled();
  });
});
