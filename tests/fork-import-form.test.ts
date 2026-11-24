// @vitest-environment happy-dom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForkImportPreview } from "@/lib/actions/fork-import";

const refresh = vi.fn();
const importForkDecklistAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/fork-import", () => ({
  importForkDecklistAction: (...args: unknown[]) => importForkDecklistAction(...args),
}));

const { ImportForkListForm } = await import("@/components/decks/import-fork-list-form");

const deckId = "d0000000-0000-4000-8000-0000000000bb";

const preview: ForkImportPreview = {
  originalName: "Atraxa Tokens",
  warnings: ["Skipped 1 card from Sideboard. Those piles aren't part of the Spellbranch deck."],
  summary: { added: 1, removed: 2, quantity: 1, unchanged: 1 },
  commanderChange: "changed",
  commanderOriginalName: "Atraxa, Praetors' Voice",
  commanderImportName: "Isshin, Two Heavens as One",
  changes: [
    {
      scryfallId: "11111111-2222-4333-8444-555555555555",
      cardName: "Atraxa, Praetors' Voice",
      manaCost: "{G}{W}{U}{B}",
      typeLine: "Legendary Creature — Phyrexian Angel Horror",
      board: "commander",
      kind: "removed",
      originalQty: 1,
      importQty: 0,
    },
    {
      scryfallId: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
      cardName: "Isshin, Two Heavens as One",
      manaCost: "{2}{R}{W}",
      typeLine: "Legendary Creature — Human Samurai",
      board: "commander",
      kind: "added",
      originalQty: 0,
      importQty: 1,
    },
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

function renderForm() {
  return render(
    createElement(ImportForkListForm, {
      deckId,
      originalName: "Atraxa Tokens",
    }),
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  importForkDecklistAction.mockReset();
  refresh.mockReset();
});

describe("ImportForkListForm", () => {
  it("previews added, removed, and quantity changes, then saves only after confirm", async () => {
    importForkDecklistAction.mockImplementation(async (_deckId: string, data: FormData) =>
      data.get("confirm") === "true" ? { saved: true, preview } : { preview },
    );
    renderForm();

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import deck list" }));
    const dialog = await screen.findByRole("dialog", { name: "Import a deck list" });
    expect(dialog.textContent).toContain("Atraxa Tokens");
    expect(screen.queryByTestId("import-fork-diff")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(importForkDecklistAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Import deck list" }));
    const list = (await screen.findByRole("textbox", { name: "Deck list" })) as HTMLTextAreaElement;
    fireEvent.change(list, { target: { value: "1 Sol Ring\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    await waitFor(() => expect(importForkDecklistAction).toHaveBeenCalledTimes(1));
    const previewData = importForkDecklistAction.mock.calls[0]?.[1] as FormData;
    expect(previewData.get("list")).toBe("1 Sol Ring\n");
    expect(previewData.get("confirm")).toBeNull();
    expect(importForkDecklistAction.mock.calls[0]?.[0]).toBe(deckId);

    const diff = await screen.findByTestId("import-fork-diff");
    expect(diff.textContent).toContain("Arcane Signet");
    expect(diff.textContent).toContain("Added");
    expect(diff.textContent).toContain("Lightning Bolt");
    expect(diff.textContent).toContain("Removed");
    expect(diff.textContent).toContain("Sideboard");
    expect(diff.textContent).toContain("Forest");
    expect(diff.textContent).toContain("Quantity");
    expect(diff.textContent).toContain("10");
    expect(diff.textContent).toContain("8");
    expect(diff.textContent).toContain("Commander");
    expect(screen.getByText(/Commander:/).textContent).toContain("Atraxa, Praetors' Voice");
    expect(screen.getByText(/Commander:/).textContent).toContain("Isshin, Two Heavens as One");
    expect(diff.textContent).toMatch(/sideboard/i);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(importForkDecklistAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Import deck list" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Deck list" }), {
      target: { value: "1 Sol Ring\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByTestId("import-fork-diff");
    const save = await screen.findByRole("button", { name: "Save import" });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => expect(importForkDecklistAction).toHaveBeenCalledTimes(3));
    const saveData = importForkDecklistAction.mock.calls[2]?.[1] as FormData;
    expect(saveData.get("confirm")).toBe("true");
    expect(saveData.get("list")).toBe("1 Sol Ring\n");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("drops a stale preview when the pasted list changes", async () => {
    importForkDecklistAction.mockResolvedValue({ preview });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Import deck list" }));
    const list = (await screen.findByRole("textbox", { name: "Deck list" })) as HTMLTextAreaElement;
    fireEvent.change(list, { target: { value: "1 Sol Ring\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await screen.findByTestId("import-fork-diff");

    fireEvent.change(list, { target: { value: "1 Sol Ring\n1 Arcane Signet\n" } });
    expect(screen.queryByTestId("import-fork-diff")).toBeNull();
    expect(screen.getByRole("button", { name: "Preview changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save import" })).toBeNull();
  });
});
