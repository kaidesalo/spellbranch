// @vitest-environment happy-dom

import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootReady, BootSplashGate } from "@/components/layout/boot-splash";
import {
  SPLASH_CIRCLES,
  SPLASH_DOT_COLOR,
  SPLASH_FADE_MS,
  SPLASH_HOLD_MS,
  SPLASH_JUNCTION_PX,
  SPLASH_LOGO_PX,
  SPLASH_MARK_CROP_PX,
  SPLASH_MIN_MS,
  SPLASH_REDUCED_MIN_MS,
  SPLASH_SHRINK_MS,
  SPLASH_START_SCRIPT,
  SPLASH_TIMEOUT_MS,
  SPLASH_TRAVEL_MS,
  resetBootSplashForTests,
  splashDecision,
  splashMinMs,
  splashPercent,
  splashPointOnMark,
  splashWaitMs,
} from "@/components/layout/boot-splash-timing";

function installMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function Harness({ label, ready }: { label: string; ready: boolean }) {
  return createElement(
    BootSplashGate,
    null,
    createElement("p", null, label),
    ready ? createElement(BootReady) : null,
  );
}

describe("splash timing", () => {
  it("keeps the overlay up until the animation can finish, then the route, then the cap", () => {
    expect(SPLASH_MIN_MS).toBe(SPLASH_TRAVEL_MS + SPLASH_SHRINK_MS + SPLASH_HOLD_MS);
    expect(SPLASH_MIN_MS).toBe(1700);
    expect(splashMinMs(false)).toBe(SPLASH_MIN_MS);
    expect(splashMinMs(true)).toBe(SPLASH_REDUCED_MIN_MS);

    const motion = { routeReady: true, reducedMotion: false };
    expect(splashDecision({ elapsedMs: SPLASH_MIN_MS - 1, ...motion })).toBe("wait");
    expect(splashDecision({ elapsedMs: SPLASH_MIN_MS, ...motion })).toBe("dismiss");
    expect(splashWaitMs({ elapsedMs: 0, ...motion })).toBe(SPLASH_MIN_MS);
    expect(splashWaitMs({ elapsedMs: 500, ...motion })).toBe(SPLASH_MIN_MS - 500);

    // Ready only after the minimum: dismiss on the ready signal, not on a second minimum.
    expect(splashDecision({ elapsedMs: 2500, routeReady: false, reducedMotion: false })).toBe("wait");
    expect(splashDecision({ elapsedMs: 2500, routeReady: true, reducedMotion: false })).toBe("dismiss");
    expect(splashWaitMs({ elapsedMs: 2500, routeReady: false, reducedMotion: false })).toBe(
      SPLASH_TIMEOUT_MS - 2500,
    );

    expect(splashDecision({ elapsedMs: SPLASH_TIMEOUT_MS - 1, routeReady: false, reducedMotion: false })).toBe(
      "wait",
    );
    expect(splashDecision({ elapsedMs: SPLASH_TIMEOUT_MS, routeReady: false, reducedMotion: false })).toBe(
      "dismiss",
    );
    expect(splashDecision({ elapsedMs: SPLASH_TIMEOUT_MS, routeReady: false, reducedMotion: true })).toBe(
      "dismiss",
    );
  });

  it("uses a short static hold when reduced motion is requested", () => {
    const reduced = { routeReady: true, reducedMotion: true };
    expect(splashDecision({ elapsedMs: SPLASH_REDUCED_MIN_MS - 1, ...reduced })).toBe("wait");
    expect(splashDecision({ elapsedMs: SPLASH_REDUCED_MIN_MS, ...reduced })).toBe("dismiss");
    expect(splashWaitMs({ elapsedMs: 0, ...reduced })).toBe(SPLASH_REDUCED_MIN_MS);
    // Still waiting on the route: the short hold does not reveal a page that is not ready.
    expect(
      splashDecision({ elapsedMs: SPLASH_REDUCED_MIN_MS, routeReady: false, reducedMotion: true }),
    ).toBe("wait");
  });

  it("moves three circles inward to the junction, then leaves one gold circle", () => {
    expect(SPLASH_LOGO_PX).toEqual({ width: 1958, height: 449 });
    expect(SPLASH_MARK_CROP_PX.width).toBeGreaterThan(342);
    expect(SPLASH_MARK_CROP_PX.width).toBeLessThan(399);
    expect(SPLASH_MARK_CROP_PX.height).toBe(SPLASH_LOGO_PX.height);

    expect(SPLASH_CIRCLES.map((circle) => circle.id)).toEqual(["top", "left", "right"]);
    expect(SPLASH_CIRCLES.map((circle) => circle.color)).toEqual(["#F7F3E3", "#2BD67B", "#FF5A4F"]);
    expect(SPLASH_DOT_COLOR).toBe("#E8B76A");
    const meet = splashPointOnMark(SPLASH_JUNCTION_PX);
    for (const circle of SPLASH_CIRCLES) {
      const from = splashPointOnMark(circle.tip);
      const distance = Math.hypot(from.x - meet.x, from.y - meet.y);
      expect(distance).toBeGreaterThan(10);
    }
    expect(meet.y).toBeLessThan(splashPercent(300, SPLASH_MARK_CROP_PX.height));
    expect(meet.x).toBeGreaterThan(40);
    expect(meet.x).toBeLessThan(60);
  });
});

describe("boot splash overlay", () => {
  beforeEach(() => {
    resetBootSplashForTests();
    vi.useFakeTimers();
    installMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetBootSplashForTests();
    vi.unstubAllGlobals();
  });

  it("dismisses at the minimum when the route is already ready", async () => {
    render(createElement(Harness, { label: "home", ready: true }));
    const splash = screen.getByTestId("boot-splash");
    expect(splash.getAttribute("data-state")).toBe("show");
    expect(splash.getAttribute("data-motion")).toBe("full");
    expect(screen.getByText("Loading Spellbranch")).toBeTruthy();
    expect(splash.querySelector(".boot-splash-card")).toBeTruthy();
    expect(splash.querySelector(".boot-splash-wordmark")).toBeNull();
    expect(splash.querySelector(".boot-splash-ball")).toBeNull();
    expect(splash.querySelector("[data-branch='bottom']")).toBeNull();
    expect(splash.querySelector(".boot-splash-ink")).toBeNull();
    expect(splash.querySelector("[data-flow]")).toBeNull();
    const images = splash.querySelectorAll("img");
    expect(images.length).toBe(1);
    expect(images[0]?.getAttribute("src")).toBe("/spellbranch-logo.png");
    expect(images[0]?.getAttribute("alt")).toBe("");

    const meet = splashPointOnMark(SPLASH_JUNCTION_PX);
    for (const circle of SPLASH_CIRCLES) {
      const node = splash.querySelector(`[data-circle="${circle.id}"]`);
      const from = splashPointOnMark(circle.tip);
      const style = node?.getAttribute("style") ?? "";
      expect(style).toContain(`--from-x: ${from.x}%`);
      expect(style).toContain(`--from-y: ${from.y}%`);
      expect(style).toContain(`--to-x: ${meet.x}%`);
      expect(style).toContain(`--to-y: ${meet.y}%`);
      expect(style).toContain(circle.color);
    }
    const finalDot = splash.querySelector("[data-final='gold']");
    expect(finalDot?.getAttribute("style")).toContain(SPLASH_DOT_COLOR);
    expect(splash.querySelector("[data-stem='bottom']")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_MIN_MS - 1);
    });
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("show");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("leaving");

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_FADE_MS);
    });
    expect(screen.queryByTestId("boot-splash")).toBeNull();
    expect(screen.getByText("home")).toBeTruthy();
  });

  it("waits for a slow route, and gives up at the timeout if the route never readies", async () => {
    const view = render(createElement(Harness, { label: "home", ready: false }));

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_MIN_MS);
    });
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("show");

    view.rerender(createElement(Harness, { label: "home", ready: true }));
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("leaving");

    cleanup();
    resetBootSplashForTests();
    render(createElement(Harness, { label: "home", ready: false }));

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_TIMEOUT_MS - 1);
    });
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("show");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("leaving");
  });

  it("skips the moving balls and uses the short hold when reduced motion is set", async () => {
    installMatchMedia(true);
    render(createElement(Harness, { label: "home", ready: true }));
    const splash = screen.getByTestId("boot-splash");
    expect(splash.getAttribute("data-motion")).toBe("reduced");
    expect(splash.querySelectorAll("[data-circle]").length).toBe(SPLASH_CIRCLES.length);
    expect(splash.querySelector("[data-final='gold']")).toBeTruthy();
    expect(splash.querySelector(".boot-splash-flow")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_REDUCED_MIN_MS - 1);
    });
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("show");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("leaving");

    const css = readFileSync(path.join(process.cwd(), "src/app/boot-splash.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.boot-splash-mark\s*\{\s*display:\s*none/);
    expect(css).toContain('.boot-splash[data-motion="reduced"] .boot-splash-mark');
    expect(css).toContain('.boot-splash[data-motion="reduced"] .boot-splash-final');
    expect(css).not.toContain("boot-splash-ink");
    expect(css).not.toContain("boot-splash-flow");
    expect(css).not.toContain("boot-splash-wordmark");
    expect(css).not.toContain("boot-splash-ball");
  });

  it("does not come back on a client navigation or a remount in the same session", async () => {
    const view = render(createElement(Harness, { label: "home", ready: true }));
    await act(async () => {
      vi.advanceTimersByTime(SPLASH_MIN_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(SPLASH_FADE_MS);
    });
    expect(screen.queryByTestId("boot-splash")).toBeNull();

    view.rerender(createElement(Harness, { label: "login", ready: true }));
    expect(screen.queryByTestId("boot-splash")).toBeNull();
    expect(screen.getByText("login")).toBeTruthy();

    cleanup();
    render(createElement(Harness, { label: "signup", ready: true }));
    expect(screen.queryByTestId("boot-splash")).toBeNull();
    expect(screen.getByText("signup")).toBeTruthy();

    // A full load is a new JS realm. The test helper stands in for that.
    cleanup();
    resetBootSplashForTests();
    render(createElement(Harness, { label: "home", ready: true }));
    expect(screen.getByTestId("boot-splash").getAttribute("data-state")).toBe("show");
  });
});

describe("splash start script", () => {
  it("stamps the clock once and leaves a later navigation's stamp alone", () => {
    expect(SPLASH_START_SCRIPT).toContain("__spellbranchSplashStart");
    expect(SPLASH_START_SCRIPT).toContain('typeof window.__spellbranchSplashStart!=="number"');
    const ran = new Function(`${SPLASH_START_SCRIPT}; return window.__spellbranchSplashStart;`);
    const first = ran();
    window.__spellbranchSplashStart = 123;
    const second = ran();
    expect(second).toBe(123);
    expect(typeof first).toBe("number");
    delete window.__spellbranchSplashStart;
  });
});
