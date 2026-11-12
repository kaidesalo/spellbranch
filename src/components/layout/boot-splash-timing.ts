/**
 * First-load splash timing and the branch geometry it animates.
 *
 * The clock starts when the inline boot script in the root layout runs
 * (HTML parse, before first paint). Hydration falls back to Date.now() if
 * that script did not run. Dismiss rules:
 *
 * - Motion: stay at least SPLASH_MIN_MS so the balls can finish one trip,
 *   and only after the initial route has signaled ready.
 * - Reduced motion: same ready check, but the minimum is a short static hold
 *   (there is no trip to wait for).
 * - Either way, dismiss at SPLASH_TIMEOUT_MS even if the route never becomes
 *   ready, so a slow or failed route cannot leave the overlay up.
 */

export const SPLASH_TRAVEL_MS = 1200;
/** Stagger of the last ball. Must match the largest `delayMs` in SPLASH_BALLS. */
export const SPLASH_LAST_DELAY_MS = 240;
/** How long the gathered balls sit before the overlay may leave. */
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
 * The stem tip is intentionally unused: the splash only animates the
 * three upper tips (left, top, right).
 */
export const SPLASH_BRANCH_TIPS_PX = {
  top: { x: 178, y: 97 },
  left: { x: 90, y: 167 },
  right: { x: 267, y: 166 },
} as const;

/**
 * First row where the three arms become one horizontal span (y=236), on the
 * trunk's center column (x=178). Balls gather here.
 */
export const SPLASH_CENTER_PX = { x: 178, y: 236 } as const;

export const SPLASH_BALLS = [
  { id: "top", tip: SPLASH_BRANCH_TIPS_PX.top, color: "#F7F3E3", delayMs: 0, gather: { x: 0, y: -1.5 } },
  { id: "left", tip: SPLASH_BRANCH_TIPS_PX.left, color: "#2BD67B", delayMs: 120, gather: { x: -1.5, y: 0.9 } },
  {
    id: "right",
    tip: SPLASH_BRANCH_TIPS_PX.right,
    color: "#FF5A4F",
    delayMs: SPLASH_LAST_DELAY_MS,
    gather: { x: 1.5, y: 0.9 },
  },
] as const;

/** Percent rounded so a tip position plus a cluster offset stays stable in CSS. */
export function splashShift(percent: number, delta: number): number {
  return Math.round((percent + delta) * 1000) / 1000;
}

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
