"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Image from "next/image";
import {
  SPLASH_BALLS,
  SPLASH_CENTER_PX,
  SPLASH_FADE_MS,
  SPLASH_TIMEOUT_MS,
  SPLASH_TRAVEL_MS,
  isBootSplashDismissed,
  markBootSplashDismissed,
  splashDecision,
  splashPointOnMark,
  splashShift,
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

function BootSplash({ phase, reducedMotion }: { phase: SplashPhase; reducedMotion: boolean }) {
  const center = splashPointOnMark(SPLASH_CENTER_PX);

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
          backgroundColor: "#10141F",
          "--splash-timeout": `${SPLASH_TIMEOUT_MS}ms`,
          "--splash-fade": `${SPLASH_FADE_MS}ms`,
          "--splash-travel": `${SPLASH_TRAVEL_MS}ms`,
        } as React.CSSProperties
      }
    >
      <span className="boot-splash-sr">Loading Spellbranch</span>
      <div className="boot-splash-stage">
        <div className="boot-splash-mark">
          {/* Same file as the header lockup. The stage crops to the branch frame. */}
          <Image
            src="/spellbranch-logo.png"
            alt=""
            width={1958}
            height={449}
            priority
            unoptimized
            className="boot-splash-mark-image"
          />
          {SPLASH_BALLS.map((ball) => {
            const from = splashPointOnMark(ball.tip);
            const toX = splashShift(center.x, ball.gather.x);
            const toY = splashShift(center.y, ball.gather.y);
            return (
              <span
                key={ball.id}
                data-branch={ball.id}
                className="boot-splash-ball"
                style={
                  {
                    "--from-x": `${from.x}%`,
                    "--from-y": `${from.y}%`,
                    "--to-x": `${toX}%`,
                    "--to-y": `${toY}%`,
                    "--delay": `${ball.delayMs}ms`,
                    "--ball": ball.color,
                    backgroundColor: ball.color,
                    color: ball.color,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
        <Image
          src="/spellbranch-logo.png"
          alt="Spellbranch"
          width={1958}
          height={449}
          priority
          unoptimized
          className="boot-splash-wordmark"
        />
      </div>
    </div>
  );
}
