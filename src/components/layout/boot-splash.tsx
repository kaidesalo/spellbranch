"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Image from "next/image";
import {
  SPLASH_CIRCLES,
  SPLASH_DOT_COLOR,
  SPLASH_FADE_MS,
  SPLASH_HOLD_MS,
  SPLASH_JUNCTION_PX,
  SPLASH_SHRINK_MS,
  SPLASH_TIMEOUT_MS,
  SPLASH_TRAVEL_MS,
  isBootSplashDismissed,
  markBootSplashDismissed,
  splashDecision,
  splashPointOnMark,
  splashWaitMs,
  type SplashClock,
} from "@/components/layout/boot-splash-timing";

const BootReadyContext = createContext<() => void>(() => {});

type SplashPhase = "show" | "leaving" | "gone";

function splashElapsed(): number {
  const start = window.__spellbranchSplashStart;
  if (typeof start !== "number") return 0;
  return Date.now() - start;
}

function ensureSplashStart(): void {
  if (typeof window.__spellbranchSplashStart !== "number") {
    window.__spellbranchSplashStart = Date.now();
  }
}

/**
 * Covers the first paint, then leaves once the initial route is ready and the
 * minimum time has elapsed. Stays dismissed for the rest of the JS session,
 * including client navigations that remount this tree.
 */
export function BootSplashGate({ children }: { children: React.ReactNode }) {
  const [routeReady, setRouteReady] = useState(false);
  const [phase, setPhase] = useState<SplashPhase>(() => (isBootSplashDismissed() ? "gone" : "show"));
  const [reducedMotion, setReducedMotion] = useState(false);
  const markReady = useCallback(() => setRouteReady(true), []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (phase !== "show") return;
    ensureSplashStart();
    let waitTimer = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled || isBootSplashDismissed()) return;
      const input: SplashClock = {
        elapsedMs: splashElapsed(),
        routeReady,
        reducedMotion,
      };
      if (splashDecision(input) === "dismiss") {
        markBootSplashDismissed();
        setPhase("leaving");
        return;
      }
      waitTimer = window.setTimeout(tick, splashWaitMs(input));
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(waitTimer);
    };
  }, [phase, reducedMotion, routeReady]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const hideTimer = window.setTimeout(() => setPhase("gone"), SPLASH_FADE_MS);
    return () => window.clearTimeout(hideTimer);
  }, [phase]);

  return (
    <BootReadyContext.Provider value={markReady}>
      {phase === "gone" ? null : <BootSplash phase={phase} reducedMotion={reducedMotion} />}
      <div className="flex min-h-dvh w-full min-w-0 flex-1 flex-col">{children}</div>
    </BootReadyContext.Provider>
  );
}

/**
 * Mounts only after the initial route's shell (session header, page, footer)
 * has committed. Client navigations keep the previous shell on screen, and a
 * repeat signal does not bring the splash back.
 */
export function BootReady() {
  const markReady = useContext(BootReadyContext);
  useEffect(() => {
    markReady();
  }, [markReady]);
  return null;
}

function Corner({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} aria-hidden>
      <path
        d="M10 58c14-4 24-16 30-32 4-10 12-16 24-18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M14 68c16-6 28-18 34-36"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M8 40c10-1 16-8 18-18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path d="M22 30c8-7 16-8 22-3-8 1-16 5-22 3z" fill="currentColor" />
      <path d="M16 42c7-5 14-5 18-1-7 1-14 4-18 1z" fill="currentColor" />
      <path d="M32 18c7-4 14-3 17 2-7 0-14 2-17-2z" fill="currentColor" />
      <path d="M40 26c5-5 12-5 15-1-6 1-12 3-15 1z" fill="currentColor" />
      <circle cx="18" cy="22" r="2.2" fill="currentColor" />
    </svg>
  );
}

function BootSplash({ phase, reducedMotion }: { phase: SplashPhase; reducedMotion: boolean }) {
  const meet = splashPointOnMark(SPLASH_JUNCTION_PX);

  return (
    <div
      className={phase === "leaving" ? "boot-splash boot-splash-leaving" : "boot-splash"}
      data-testid="boot-splash"
      data-state={phase}
      data-motion={reducedMotion ? "reduced" : "full"}
      role="status"
      aria-live="polite"
      aria-busy={phase === "show"}
      style={
        {
          backgroundColor: "#2c1b10",
          "--splash-timeout": `${SPLASH_TIMEOUT_MS}ms`,
          "--splash-fade": `${SPLASH_FADE_MS}ms`,
          "--splash-travel": `${SPLASH_TRAVEL_MS}ms`,
          "--splash-shrink": `${SPLASH_SHRINK_MS}ms`,
          "--splash-hold": `${SPLASH_HOLD_MS}ms`,
          "--origin-x": `${meet.x}%`,
          "--origin-y": `${meet.y}%`,
        } as React.CSSProperties
      }
    >
      <span className="boot-splash-sr">Loading Spellbranch</span>
      <div className="boot-splash-scene">
        <div className="boot-splash-card">
          <div className="boot-splash-card-face">
            <Corner className="boot-splash-corner boot-splash-corner-nw" />
            <Corner className="boot-splash-corner boot-splash-corner-ne" />
            <Corner className="boot-splash-corner boot-splash-corner-sw" />
            <Corner className="boot-splash-corner boot-splash-corner-se" />
            <div className="boot-splash-slot">
              <div className="boot-splash-mark">
                <Image
                  src="/spellbranch-logo.png"
                  alt=""
                  width={1958}
                  height={449}
                  priority
                  unoptimized
                  className="boot-splash-mark-image"
                />
                {SPLASH_CIRCLES.map((circle) => {
                  const from = splashPointOnMark(circle.tip);
                  return (
                    <span
                      key={circle.id}
                      data-circle={circle.id}
                      className="boot-splash-circle"
                      style={
                        {
                          "--from-x": `${from.x}%`,
                          "--from-y": `${from.y}%`,
                          "--to-x": `${meet.x}%`,
                          "--to-y": `${meet.y}%`,
                          "--circle": circle.color,
                          backgroundColor: circle.color,
                        } as React.CSSProperties
                      }
                    />
                  );
                })}
              </div>
              <span data-final="gold" className="boot-splash-final" style={{ backgroundColor: SPLASH_DOT_COLOR }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
