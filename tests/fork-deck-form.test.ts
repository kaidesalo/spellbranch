// @vitest-environment happy-dom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/decks", () => ({
  forkDeckAction: vi.fn(async () => ({ success: true })),
}));

const { forkDeckAction } = await import("@/lib/actions/decks");
const { ForkDeckForm } = await import("@/components/decks/fork-deck-form");

const deckId = "d0000000-0000-4000-8000-000000000001";
const mockedFork = vi.mocked(forkDeckAction);

function renderForm() {
  return render(
    createElement(ForkDeckForm, {
      deckId,
      defaultName: "Live and Burn (branch)",
    }),
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  mockedFork.mockReset();
  mockedFork.mockResolvedValue({ success: true });
});

describe("ForkDeckForm", () => {
  it("keeps the name field off the page until Fork is clicked", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Fork deck" }).textContent).toContain("Fork");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.body.textContent).not.toContain("Branch name");
    expect(mockedFork).not.toHaveBeenCalled();
  });

  it("opens a labelled dialog on the prefilled name and forks only after confirm", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Fork deck" }));

    const popup = await screen.findByRole("dialog", { name: "Fork this deck" });
    expect(popup.getAttribute("aria-modal")).toBe("true");
    expect(popup.textContent).toContain("Anyone who can see the branch will see this name.");
    // Modal focus trap: guards sit beside the popup and wrap Tab back inside.
    // The page behind the dialog is hidden from assistive tech.
    expect(document.querySelectorAll("[data-base-ui-focus-guard]").length).toBeGreaterThanOrEqual(2);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Fork deck", hidden: true }).closest("[aria-hidden='true']"),
      ).not.toBeNull();
    });

    const input = screen.getByRole("textbox", { name: "Branch name" }) as HTMLInputElement;
    expect(input.value).toBe("Live and Burn (branch)");
    expect(input.required).toBe(true);
    expect(input.maxLength).toBe(80);
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockedFork).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Fork deck" }));
    const reopened = (await screen.findByRole("textbox", { name: "Branch name" })) as HTMLInputElement;
    expect(reopened.value).toBe("Live and Burn (branch)");

    fireEvent.change(reopened, { target: { value: "   " } });
    fireEvent.submit(reopened.closest("form")!);
    expect(mockedFork).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Deck name is required");
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Branch name" }), {
      target: { value: "  Shadow test  " },
    });
    fireEvent.submit(screen.getByRole("textbox", { name: "Branch name" }).closest("form")!);
    expect(mockedFork).toHaveBeenCalledTimes(1);
    expect(mockedFork.mock.calls[0][0]).toBe(deckId);
    expect((mockedFork.mock.calls[0][1] as FormData).get("name")).toBe("Shadow test");
  });

  it("Escape closes the dialog without forking", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Fork deck" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockedFork).not.toHaveBeenCalled();
  });
});
