// @vitest-environment happy-dom

import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootReady, BootSplashGate } from "@/components/layout/boot-splash";
import {
  SPLASH_BALLS,
  SPLASH_BRANCH_TIPS_PX,
  SPLASH_CENTER_PX,
  SPLASH_FADE_MS,
  SPLASH_HOLD_MS,
  SPLASH_LAST_DELAY_MS,
  SPLASH_LOGO_PX,
  SPLASH_MARK_CROP_PX,
  SPLASH_MIN_MS,
  SPLASH_REDUCED_MIN_MS,
  SPLASH_START_SCRIPT,
  SPLASH_TIMEOUT_MS,
  SPLASH_TRAVEL_MS,
  resetBootSplashForTests,
  splashDecision,
  splashMinMs,
  splashPercent,
  splashPointOnMark,
  splashShift,
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
    expect(SPLASH_MIN_MS).toBe(SPLASH_TRAVEL_MS + SPLASH_LAST_DELAY_MS + SPLASH_HOLD_MS);
    expect(Math.max(...SPLASH_BALLS.map((ball) => ball.delayMs))).toBe(SPLASH_LAST_DELAY_MS);
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

  it("maps ball starts from the logo file's branch tips onto the cropped mark", () => {
    expect(SPLASH_LOGO_PX).toEqual({ width: 1958, height: 449 });
    // Crop covers the frame (ends at x=342) and stops before the wordmark (x=399).
    expect(SPLASH_MARK_CROP_PX.width).toBeGreaterThan(342);
    expect(SPLASH_MARK_CROP_PX.width).toBeLessThan(399);
    expect(SPLASH_MARK_CROP_PX.height).toBe(SPLASH_LOGO_PX.height);

    expect(splashPointOnMark(SPLASH_BRANCH_TIPS_PX.top)).toEqual({
      x: splashPercent(178, 370),
      y: splashPercent(97, 449),
    });
    expect(splashPointOnMark(SPLASH_BRANCH_TIPS_PX.left).x).toBe(splashPercent(90, 370));
    expect(splashPointOnMark(SPLASH_BRANCH_TIPS_PX.right).x).toBe(splashPercent(267, 370));
    expect(splashPointOnMark(SPLASH_BRANCH_TIPS_PX.bottom).y).toBe(splashPercent(357, 449));
    expect(splashPointOnMark(SPLASH_CENTER_PX)).toEqual({
      x: splashPercent(178, 370),
      y: splashPercent(236, 449),
    });
    // Tips sit away from the junction, one per direction.
    const center = splashPointOnMark(SPLASH_CENTER_PX);
    const top = splashPointOnMark(SPLASH_BRANCH_TIPS_PX.top);
    const left = splashPointOnMark(SPLASH_BRANCH_TIPS_PX.left);
    const right = splashPointOnMark(SPLASH_BRANCH_TIPS_PX.right);
    const bottom = splashPointOnMark(SPLASH_BRANCH_TIPS_PX.bottom);
    expect(top.y).toBeLessThan(center.y);
    expect(bottom.y).toBeGreaterThan(center.y);
    expect(left.x).toBeLessThan(center.x);
    expect(right.x).toBeGreaterThan(center.x);
    expect(SPLASH_BALLS.map((ball) => ball.id)).toEqual(["top", "left", "right", "bottom"]);
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
    expect(splash.querySelectorAll("img").length).toBe(2);
    for (const img of splash.querySelectorAll("img")) {
      expect(img.getAttribute("src")).toBe("/spellbranch-logo.png");
    }

    const center = splashPointOnMark(SPLASH_CENTER_PX);
    for (const ball of SPLASH_BALLS) {
      const node = splash.querySelector(`[data-branch="${ball.id}"]`);
      const from = splashPointOnMark(ball.tip);
      const toX = splashShift(center.x, ball.gather.x);
      const toY = splashShift(center.y, ball.gather.y);
      expect(node).toBeTruthy();
      const style = node?.getAttribute("style") ?? "";
      expect(style).toContain(`--from-x: ${from.x}%`);
      expect(style).toContain(`--from-y: ${from.y}%`);
      expect(style).toContain(`--to-x: ${toX}%`);
      expect(style).toContain(`--to-y: ${toY}%`);
      expect(style).toContain(`--delay: ${ball.delayMs}ms`);
    }

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
    expect(splash.querySelectorAll("[data-branch]").length).toBe(SPLASH_BALLS.length);

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
    expect(css).toMatch(/\.boot-splash-ball\s*\{\s*display:\s*none/);
    expect(css).toContain('.boot-splash[data-motion="reduced"] .boot-splash-ball');
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
