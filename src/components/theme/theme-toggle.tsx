"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { THEME_CHOICES, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

function useClientReady() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

const ICONS: Record<ThemeChoice, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const LABELS: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Three-way color mode control. Native radios so arrow keys, Tab, and
 * screen readers get real radiogroup behavior. The checked choice is System
 * until mount, matching the server render (the saved choice is in
 * localStorage, which the server cannot see).
 */
export function ThemeRadiogroup({
  labelledBy,
  showLabels = false,
  compact = false,
  className,
}: {
  labelledBy?: string;
  showLabels?: boolean;
  /** Header bar: shorter targets. Touch menus keep the 44px minimum. */
  compact?: boolean;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const ready = useClientReady();
  const name = useId();

  const selected: ThemeChoice =
    ready && (theme === "light" || theme === "dark" || theme === "system") ? theme : "system";

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : "Color mode"}
      aria-labelledby={labelledBy}
      className={cn("inline-flex items-center", className)}
    >
      {THEME_CHOICES.map((choice) => {
        const Icon = ICONS[choice];
        const checked = selected === choice;
        return (
          <label
            key={choice}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium",
              compact ? "min-h-8 min-w-8" : "min-h-11 min-w-11",
              "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
              checked
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice}
              checked={checked}
              onChange={() => setTheme(choice)}
              className="sr-only"
            />
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className={showLabels ? "" : "sr-only"}>{LABELS[choice]}</span>
          </label>
        );
      })}
    </div>
  );
}

function ThemeSummaryIcon() {
  const { theme } = useTheme();
  const ready = useClientReady();
  const choice: ThemeChoice =
    ready && (theme === "light" || theme === "dark" || theme === "system") ? theme : "system";
  const Icon = ICONS[choice];
  return <Icon className="size-5" aria-hidden />;
}

/**
 * Header control. Below the `sm` breakpoint it is a disclosure (one 44px
 * target) that opens the radiogroup. From `sm` up the radiogroup is inline.
 * The mobile nav renders ThemeRadiogroup on its own.
 */
export function ThemeToggle() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const root = detailsRef.current;
      if (!root?.open) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      root.open = false;
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div data-testid="theme-toggle" className="flex shrink-0 items-center">
      <details
        ref={detailsRef}
        className="relative sm:hidden"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !detailsRef.current?.open) return;
          detailsRef.current.open = false;
          detailsRef.current.querySelector("summary")?.focus();
        }}
      >
        <summary
          aria-label="Color mode"
          className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden"
        >
          <ThemeSummaryIcon />
        </summary>
        <div className="absolute right-0 z-50 mt-2 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          <ThemeRadiogroup showLabels className="flex flex-col" />
        </div>
      </details>
      <ThemeRadiogroup
        compact
        className="hidden rounded-lg border border-border bg-card p-0.5 sm:inline-flex"
      />
    </div>
  );
}
