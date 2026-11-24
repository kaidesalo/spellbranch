// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckWithMeta } from "@/lib/types";
import type { ForkImportPreview } from "@/lib/actions/fork-import";

const session = vi.hoisted(() => ({
  user: { id: "me", email: "me@example.test", username: "me", displayName: "Me" } as
    | { id: string; email: string; username: string; displayName: string }
    | null,
}));
const permissions = vi.hoisted(() => ({
  canEdit: true,
  canFork: false,
  canCopy: false,
  canComment: false,
}));
const deckBox = vi.hoisted(() => ({ deck: null as DeckWithMeta | null }));
const importForkDecklistAction = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));
vi.mock("@/lib/queries/decks", () => ({
  getDeckById: async () => deckBox.deck,
  getDeckPermissions: async () => permissions,
}));
vi.mock("@/lib/queries/comments", () => ({ listComments: async () => [] }));
vi.mock("@/lib/deck-stats-load", () => ({
  loadDeckStats: async () => ({ scryfallUnavailable: false, includesCommander: false }),
}));
vi.mock("@/lib/actions/fork-import", () => ({
  importForkDecklistAction: (...args: unknown[]) => importForkDecklistAction(...args),
}));
vi.mock("@/components/cards/card-search", () => ({ CardSearch: () => null }));
vi.mock("@/components/decks/deck-list", () => ({ DeckList: () => null }));
vi.mock("@/components/decks/category-manager", () => ({ CategoryManager: () => null }));
vi.mock("@/components/decks/commander-slot", () => ({ CommanderSlot: () => null }));
vi.mock("@/components/comments/comment-section", () => ({ CommentSection: () => null }));
vi.mock("@/components/decks/deck-stats", () => ({ DeckStatistics: () => null }));
vi.mock("@/components/decks/deck-breakdown", () => ({ DeckBreakdownPanel: () => null }));
vi.mock("@/components/decks/delete-deck-button", () => ({ DeleteDeckButton: () => null }));
vi.mock("@/components/decks/fork-deck-form", () => ({ ForkDeckForm: () => null }));
vi.mock("@/components/decks/copy-deck-form", () => ({ CopyDeckForm: () => null }));
vi.mock("@/components/decks/export-deck-button", () => ({ ExportDeckButton: () => null }));

const { default: DeckDetailPage } = await import("@/app/decks/[id]/page");

const ME = "a0000000-0000-4000-8000-000000000001";
const ORIGINAL = "d0000000-0000-4000-8000-0000000000aa";
const FORK = "d0000000-0000-4000-8000-0000000000bb";

function deck(over: Partial<DeckWithMeta> = {}): DeckWithMeta {
  return {
    id: FORK,
    ownerId: ME,
    name: "Atraxa branch",
    format: "commander",
    notes: "",
    visibility: "private",
    allowForks: true,
    forkedFromId: ORIGINAL,
    preferredBranchId: null,
    commander: {
      scryfallId: "11111111-2222-4333-8444-555555555555",
      cardName: "Atraxa, Praetors' Voice",
      typeLine: "Legendary Creature — Phyrexian Angel Horror",
      manaCost: "{G}{W}{U}{B}",
      imageUri: null,
      artUri: null,
      colorIdentity: ["W", "U", "B", "G"],
    },
    colors: ["W", "U", "B", "G"],
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    cards: [],
    sourceDeck: {
      id: ORIGINAL,
      ownerId: ME,
      name: "Atraxa Tokens",
      format: "commander",
      notes: "",
      visibility: "public",
      allowForks: true,
      forkedFromId: null,
      preferredBranchId: null,
      commander: null,
      colors: ["W", "U", "B", "G"],
      createdAt: "2026-11-11T00:00:00.000Z",
      updatedAt: "2026-11-11T00:00:00.000Z",
    },
    ...over,
  };
}

const preview: ForkImportPreview = {
  originalName: "Atraxa Tokens",
  warnings: [],
  summary: { added: 1, removed: 1, quantity: 1, unchanged: 1 },
  commanderChange: "same",
  commanderOriginalName: "Atraxa, Praetors' Voice",
  commanderImportName: "Atraxa, Praetors' Voice",
  changes: [
    {
      scryfallId: "55555555-6666-4777-8888-999999999999",
      cardName: "Arcane Signet",
      manaCost: "{2}",
      typeLine: "Artifact",
      board: "main",
      kind: "added",
      originalQty: 0,
      importQty: 1,
    },
    {
      scryfallId: "44444444-5555-4666-8777-888888888888",
      cardName: "Lightning Bolt",
      manaCost: "{R}",
      typeLine: "Instant",
      board: "side",
      kind: "removed",
      originalQty: 1,
      importQty: 0,
    },
    {
      scryfallId: "33333333-4444-4555-8666-777777777777",
      cardName: "Forest",
      manaCost: "",
      typeLine: "Basic Land — Forest",
      board: "main",
      kind: "quantity",
      originalQty: 10,
      importQty: 8,
    },
  ],
};

async function renderPage() {
  render(
    await DeckDetailPage({
      params: Promise.resolve({ id: deckBox.deck?.id ?? FORK }),
      searchParams: Promise.resolve({}),
    }),
  );
}

beforeEach(() => {
  session.user = { id: ME, email: "me@example.test", username: "me", displayName: "Me" };
  permissions.canEdit = true;
  deckBox.deck = deck();
  importForkDecklistAction.mockReset();
  importForkDecklistAction.mockResolvedValue({ preview });
});

afterEach(() => {
  cleanup();
});

describe("fork deck page import", () => {
  it("shows the import action on an owned fork and previews the diff", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Import deck list" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Deck list" }), {
      target: { value: "1 Sol Ring\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    const diff = await screen.findByTestId("import-fork-diff");
    expect(diff.textContent).toContain("Arcane Signet");
    expect(diff.textContent).toContain("Added");
    expect(diff.textContent).toContain("Lightning Bolt");
    expect(diff.textContent).toContain("Removed");
    expect(diff.textContent).toContain("Sideboard");
    expect(diff.textContent).toContain("Forest");
    expect(diff.textContent).toContain("Quantity");
    expect(diff.textContent).toContain("Changes from Atraxa Tokens");
    expect(screen.getByRole("button", { name: "Save import" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("hides the import action on a root deck, a copy, and a fork the viewer does not own", async () => {
    deckBox.deck = deck({ id: ORIGINAL, forkedFromId: null, sourceDeck: null, name: "Atraxa Tokens" });
    await renderPage();
    expect(screen.queryByRole("button", { name: "Import deck list" })).toBeNull();
    cleanup();

    deckBox.deck = deck({ forkedFromId: null, copiedFromId: ORIGINAL, sourceDeck: null, name: "A copy" });
    await renderPage();
    expect(screen.queryByRole("button", { name: "Import deck list" })).toBeNull();
    cleanup();

    permissions.canEdit = false;
    deckBox.deck = deck();
    await renderPage();
    expect(screen.queryByRole("button", { name: "Import deck list" })).toBeNull();
    cleanup();

    permissions.canEdit = true;
    deckBox.deck = deck({ sourceDeck: null });
    await renderPage();
    expect(screen.queryByRole("button", { name: "Import deck list" })).toBeNull();
  });
});
