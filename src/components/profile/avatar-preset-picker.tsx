"use client";

import { AVATAR_PRESETS, avatarCreditName, type AvatarPresetKey } from "@/lib/avatar-presets";
import { cn } from "@/lib/utils";

const tileClass =
  "flex min-h-11 w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-border bg-card p-2 text-center text-xs font-medium leading-snug text-foreground outline-none transition has-[:checked]:border-primary has-[:checked]:bg-primary/15 has-[:checked]:shadow-[3px_3px_0_0_#E8B76A] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background";

/**
 * Radio grid on Edit profile. The value is a preset key, or "" for none.
 * The save action allowlists the key; this control never sends a URL.
 */
export function AvatarPresetPicker({ current }: { current: string | null }) {
  const selected = AVATAR_PRESETS.some((preset) => preset.key === current) ? current : "";

  return (
    <fieldset className="min-w-0 space-y-2" data-testid="avatar-preset-picker">
      <legend className="text-sm font-medium text-foreground">Profile picture</legend>
      <div
        role="radiogroup"
        aria-label="Profile picture"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      >
        <label className={tileClass}>
          <input
            type="radio"
            name="avatarPreset"
            value=""
            defaultChecked={selected === ""}
            aria-label="None / use default"
            className="sr-only"
          />
          <span className="flex size-16 items-center justify-center rounded-full border border-border bg-secondary text-sm text-primary">
            Aa
          </span>
          <span>None / use default</span>
        </label>
        {AVATAR_PRESETS.map((preset) => (
          <label key={preset.key} className={cn(tileClass)}>
            <input
              type="radio"
              name="avatarPreset"
              value={preset.key}
              defaultChecked={selected === preset.key}
              aria-label={avatarCreditName(preset)}
              className="sr-only"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preset.src256}
              alt=""
              width={64}
              height={64}
              className="size-16 rounded-full object-cover"
            />
            <span className="max-w-full break-words">{preset.label}</span>
            <span className="max-w-full break-words text-[11px] font-normal text-muted-foreground">
              art by {preset.artist}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export type { AvatarPresetKey };
