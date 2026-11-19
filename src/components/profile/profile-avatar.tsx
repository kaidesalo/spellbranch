"use client";

import { useState } from "react";
import { resolveAvatar } from "@/lib/avatar-presets";
import { AVATAR_REFERRER_POLICY, profileInitials } from "@/lib/profile-display";
import { cn } from "@/lib/utils";

/**
 * The round picture used everywhere an account is shown. A preset or a safe
 * avatar URL, otherwise initials. Plain img, same as the account menu: remote
 * avatar hosts are not in next/image remotePatterns, and preset files are on
 * this origin.
 */
export function ProfileAvatar({
  avatarPreset,
  avatarUrl,
  displayName,
  username,
  size = "menu",
  className,
}: {
  avatarPreset?: string | null;
  avatarUrl?: string | null;
  displayName: string;
  username: string;
  /** menu: 44px header. profile: the public profile header. */
  size?: "menu" | "profile";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const picture = broken
    ? null
    : resolveAvatar({ avatarPreset, avatarUrl }, size === "profile" ? 512 : 256);
  const initials = profileInitials(displayName, username);

  return (
    <span
      data-testid="profile-avatar"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/80 bg-secondary text-xs font-medium text-primary",
        size === "menu" ? "size-11" : "size-16 text-base sm:size-20 sm:text-lg",
        className,
      )}
    >
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picture.src}
          alt={picture.alt}
          title={picture.title}
          referrerPolicy={AVATAR_REFERRER_POLICY}
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}
