// @vitest-environment happy-dom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/decks", () => ({
  copyDeckAction: vi.fn(async () => ({ success: true })),
}));

const { copyDeckAction } = await import("@/lib/actions/decks");
const { CopyDeckForm } = await import("@/components/decks/copy-deck-form");

const deckId = "d0000000-0000-4000-8000-000000000001";
const mockedCopy = vi.mocked(copyDeckAction);

function renderForm() {
  return render(
    createElement(CopyDeckForm, {
      deckId,
      defaultName: "Live and Burn (copy)",
    }),
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  mockedCopy.mockReset();
  mockedCopy.mockResolvedValue({ success: true });
});

describe("CopyDeckForm", () => {
  it("keeps the name field off the page until Copy is clicked", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Copy deck" }).textContent).toContain("Copy");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.body.textContent).not.toContain("Deck name");
    expect(mockedCopy).not.toHaveBeenCalled();
  });

  it("opens a dialog on the prefilled (copy) name and copies only after confirm", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Copy deck" }));

    const popup = await screen.findByRole("dialog", { name: "Copy this deck" });
    expect(popup.getAttribute("aria-modal")).toBe("true");
    expect(popup.textContent).toContain("It is a separate deck, not a branch.");

    const input = screen.getByRole("textbox", { name: "Deck name" }) as HTMLInputElement;
    expect(input.value).toBe("Live and Burn (copy)");
    expect(input.maxLength).toBe(80);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockedCopy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Copy deck" }));
    const reopened = (await screen.findByRole("textbox", { name: "Deck name" })) as HTMLInputElement;
    fireEvent.change(reopened, { target: { value: "  Burn copy  " } });
    fireEvent.submit(reopened.closest("form")!);
    await waitFor(() => expect(mockedCopy).toHaveBeenCalledTimes(1));
    const formData = mockedCopy.mock.calls[0][1] as FormData;
    expect(formData.get("name")).toBe("Burn copy");
  });
});
