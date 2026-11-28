"use client";

import { useId, useSyncExternalStore } from "react";
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
  align = "center",
  className,
}: {
  labelledBy?: string;
  showLabels?: boolean;
  /** Header bar: shorter targets. Touch menus keep the 44px minimum. */
  compact?: boolean;
  /** Stacked menu rows sit left. The desktop bar centers the icon. */
  align?: "center" | "start";
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
              "cursor-pointer items-center gap-1.5 rounded-md text-sm font-medium",
              align === "start" ? "flex w-full justify-start px-3" : "inline-flex justify-center px-2",
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

/**
 * Desktop header control. Hidden below `md`; the phone menu renders
 * ThemeRadiogroup on its own so the bar is not a second color control.
 */
export function ThemeToggle() {
  return (
    <div data-testid="theme-toggle" className="hidden shrink-0 items-center md:flex">
      <ThemeRadiogroup compact className="rounded-lg border border-border bg-card p-0.5" />
    </div>
  );
}
