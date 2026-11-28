// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

type Listener = (event: { matches: boolean; media: string }) => void;

function installColorScheme(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  const query = "(prefers-color-scheme: dark)";
  const list = {
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener(cb: Listener) {
      listeners.add(cb);
    },
    removeListener(cb: Listener) {
      listeners.delete(cb);
    },
    addEventListener(_type: string, cb: Listener) {
      listeners.add(cb);
    },
    removeEventListener(_type: string, cb: Listener) {
      listeners.delete(cb);
    },
    dispatchEvent() {
      return true;
    },
  };
  vi.stubGlobal("matchMedia", (media: string) => {
    if (media === query) return list;
    return {
      matches: false,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    };
  });
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next, media: query });
    },
  };
}

function renderToggle() {
  return render(
    createElement(ThemeProvider, null, createElement(ThemeToggle) as ReactNode),
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  vi.unstubAllGlobals();
});

describe("color mode toggle", () => {
  it("starts on system, then saves light or dark and marks the radio", () => {
    installColorScheme(false);
    renderToggle();

    const systems = screen.getAllByRole("radio", { name: "System" });
    expect(systems[0]?.getAttribute("aria-checked") ?? (systems[0] as HTMLInputElement).checked).toBeTruthy();
    expect((systems[0] as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(true);

    fireEvent.click(screen.getAllByRole("radio", { name: "Dark" })[0]!);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect((screen.getAllByRole("radio", { name: "Dark" })[0] as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    fireEvent.click(screen.getAllByRole("radio", { name: "Light" })[0]!);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows a live OS change only while system is selected", () => {
    const media = installColorScheme(false);
    renderToggle();
    expect(document.documentElement.classList.contains("light")).toBe(true);

    media.set(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getAllByRole("radio", { name: "Light" })[0]!);
    media.set(true);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    fireEvent.click(screen.getAllByRole("radio", { name: "System" })[0]!);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    media.set(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("restores a saved choice and keeps the other html classes", () => {
    document.documentElement.className = "h-full antialiased";
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    installColorScheme(false);
    renderToggle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("h-full")).toBe(true);
    expect(document.documentElement.classList.contains("antialiased")).toBe(true);
    expect((screen.getAllByRole("radio", { name: "Dark" })[0] as HTMLInputElement).checked).toBe(true);
  });

  it("exposes a labelled radiogroup and a focus ring on each choice", () => {
    installColorScheme(false);
    renderToggle();
    const groups = screen.getAllByRole("radiogroup", { name: "Color mode" });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const light = screen.getAllByRole("radio", { name: "Light" })[0] as HTMLInputElement;
    expect(light.type).toBe("radio");
    expect(light.name).toBeTruthy();
    const sameGroup = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).name === light.name);
    expect(sameGroup.map((radio) => (radio as HTMLInputElement).value).sort()).toEqual([
      "dark",
      "light",
      "system",
    ]);
    expect(light.closest("label")?.className).toContain("has-[:focus-visible]:ring-2");
  });
});
