/**
 * First-load splash timing and the branch geometry it animates.
 *
 * The clock starts when the inline boot script in the root layout runs
 * (HTML parse, before first paint). Hydration falls back to Date.now() if
 * that script did not run. Dismiss rules:
 *
 * - Motion: stay at least SPLASH_MIN_MS so the branch colors can finish one
 *   trip down to the stem, and only after the initial route has signaled ready.
 * - Reduced motion: same ready check, but the minimum is a short static hold
 *   (there is no trip to wait for).
 * - Either way, dismiss at SPLASH_TIMEOUT_MS even if the route never becomes
 *   ready, so a slow or failed route cannot leave the overlay up.
 */

export const SPLASH_TRAVEL_MS = 1200;
/** Stagger of the last color. Must match the largest `delayMs` in SPLASH_FLOWS. */
export const SPLASH_LAST_DELAY_MS = 240;
/** How long the yellow stem sits after the last color arrives. */
export const SPLASH_HOLD_MS = 260;
/** Minimum overlay time when motion is allowed. */
export const SPLASH_MIN_MS = SPLASH_TRAVEL_MS + SPLASH_LAST_DELAY_MS + SPLASH_HOLD_MS;
/** Static-logo hold when `prefers-reduced-motion: reduce` matches. */
export const SPLASH_REDUCED_MIN_MS = 400;
/** Opacity fade after the dismiss decision. Pointer events end when it starts. */
export const SPLASH_FADE_MS = 320;
/**
 * Hard cap measured from splash start. Also the CSS failsafe delay, so the
 * overlay still leaves if hydration never happens.
 */
export const SPLASH_TIMEOUT_MS = 4000;

/**
 * public/spellbranch-logo.png. The framed branch sits on the left; the
 * wordmark ink starts at x=399, so the animated stage crops to x=0..370.
 */
export const SPLASH_LOGO_PX = { width: 1958, height: 449 } as const;

/**
 * Left slice that contains the whole gold frame (x 11–342) and stops in the
 * transparent gap before the wordmark.
 */
export const SPLASH_MARK_CROP_PX = { width: 370, height: 449 } as const;

/**
 * Endpoints of a Zhang-Suen skeleton of the interior branch component
 * (bbox x 60–297, y 68–386; the outer frame is a separate component).
 */
export const SPLASH_BRANCH_TIPS_PX = {
  top: { x: 178, y: 97 },
  left: { x: 90, y: 167 },
  right: { x: 267, y: 166 },
} as const;

/**
 * Equator of the bottom stem bulb (widest row y=354, x 148–208).
 * The three colors meet here, and this circle is filled yellow.
 */
export const SPLASH_STEM_PX = { x: 178, y: 354 } as const;

export const SPLASH_STEM_COLOR = "#F6D21A";
/** Yellow stem fades in across the last color's arrival (finishes at travel + last stagger). */
export const SPLASH_STEM_IN_DELAY_MS = SPLASH_TRAVEL_MS - 100;
export const SPLASH_STEM_IN_MS = SPLASH_LAST_DELAY_MS + 100;

/** Tip bulbs in crop pixels. A masked fill this size covers the gold tip. */
export const SPLASH_TIPS = [
  { id: "top", cx: 178, cy: 102, r: 36, color: "#F7F3E3", delayMs: 0 },
  { id: "left", cx: 93, cy: 172, r: 36, color: "#2BD67B", delayMs: 120 },
  { id: "right", cx: 265, cy: 172, r: 36, color: "#FF5A4F", delayMs: SPLASH_LAST_DELAY_MS },
] as const;

/**
 * Centerlines from each tip down its arm, through the fork (around y=245),
 * and along the trunk to just above the stem bulb. Crop-pixel viewBox 370×449.
 */
export const SPLASH_FLOWS = [
  { id: "top", color: "#F7F3E3", delayMs: 0, d: "M178 118 L178 328" },
  { id: "left", color: "#2BD67B", delayMs: 120, d: "M100 176 C96 200 128 224 178 252 L178 328" },
  { id: "right", color: "#FF5A4F", delayMs: SPLASH_LAST_DELAY_MS, d: "M258 176 C262 200 230 224 178 252 L178 328" },
] as const;

/** Runs at parse time. Does not move an existing stamp (client navigations re-send the layout). */
export const SPLASH_START_SCRIPT =
  'if(typeof window.__spellbranchSplashStart!=="number")window.__spellbranchSplashStart=Date.now()';

export type SplashPoint = { x: number; y: number };

export type SplashClock = {
  elapsedMs: number;
  routeReady: boolean;
  reducedMotion: boolean;
};

/** Percentage rounded to 3 decimal places so CSS and tests share one string. */
export function splashPercent(part: number, whole: number): number {
  return Math.round((part / whole) * 100000) / 1000;
}

/**
 * Position of a source pixel on the cropped mark stage.
 * The stage's aspect ratio is the crop, the image is height-fitted and
 * left-aligned, so x maps through the 370px crop and y through the full height.
 */
export function splashPointOnMark(point: SplashPoint): SplashPoint {
  return {
    x: splashPercent(point.x, SPLASH_MARK_CROP_PX.width),
    y: splashPercent(point.y, SPLASH_MARK_CROP_PX.height),
  };
}

export function splashMinMs(reducedMotion: boolean): number {
  return reducedMotion ? SPLASH_REDUCED_MIN_MS : SPLASH_MIN_MS;
}

export function splashDecision(input: SplashClock): "wait" | "dismiss" {
  if (input.elapsedMs >= SPLASH_TIMEOUT_MS) return "dismiss";
  if (input.routeReady && input.elapsedMs >= splashMinMs(input.reducedMotion)) return "dismiss";
  return "wait";
}

/** Milliseconds until the next moment `splashDecision` could change on its own. */
export function splashWaitMs(input: SplashClock): number {
  if (splashDecision(input) === "dismiss") return 0;
  const deadline = input.routeReady ? splashMinMs(input.reducedMotion) : SPLASH_TIMEOUT_MS;
  return Math.max(0, deadline - input.elapsedMs);
}

let splashDismissed = false;

export function isBootSplashDismissed(): boolean {
  return splashDismissed;
}

export function markBootSplashDismissed(): void {
  splashDismissed = true;
}

/** Full page loads start a new JS realm, so this only matters inside one session (and tests). */
export function resetBootSplashForTests(): void {
  splashDismissed = false;
  if (typeof window !== "undefined") {
    delete window.__spellbranchSplashStart;
  }
}

declare global {
  interface Window {
    __spellbranchSplashStart?: number;
  }
}
