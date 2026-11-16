"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/actions/auth";
import { AVATAR_REFERRER_POLICY, profileInitials, safeAvatarUrl } from "@/lib/profile-display";
import type { SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Account destinations that already exist. Profile is the public page;
 * Edit profile is the settings form at /profile. Favorites stayed in the
 * account cluster when the main nav was cut to five items.
 */
export function accountMenuItems(username: string): { href: string; label: string }[] {
  return [
    { href: `/u/${username}`, label: "Profile" },
    { href: "/profile", label: "Edit profile" },
    { href: "/favorites", label: "Favorites" },
  ];
}

const itemClass =
  "min-h-11 w-full cursor-pointer rounded-md px-3 text-sm text-foreground focus:bg-primary focus:text-primary-foreground data-highlighted:bg-primary data-highlighted:text-primary-foreground";

export function AccountMenu({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const picture = safeAvatarUrl(user.avatarUrl);
  const [broken, setBroken] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showPicture = Boolean(picture) && !broken;
  const items = accountMenuItems(user.username);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) triggerRef.current?.focus();
      }}
    >
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-label={`Account menu for ${user.username}`}
        className="hidden size-11 shrink-0 items-center justify-center rounded-full border border-primary/80 bg-secondary p-0.5 text-xs font-medium text-primary outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
      >
        <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-secondary">
          {showPicture ? (
            // Plain img: avatar hosts are not in next.config remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picture!}
              alt=""
              referrerPolicy={AVATAR_REFERRER_POLICY}
              className="size-full object-cover"
              onError={() => setBroken(true)}
            />
          ) : (
            <span aria-hidden>{profileInitials(user.displayName, user.username)}</span>
          )}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-56! border border-primary/40 bg-background p-1.5 text-foreground shadow-xl"
      >
        <div className="px-3 py-2">
          <span className="block truncate text-sm font-medium text-foreground">{user.displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
        </div>
        {items.map((item) => {
          const current = pathname === item.href;
          return (
            <DropdownMenuItem
              key={item.href}
              className={cn(itemClass, current && "bg-primary/15 text-primary")}
              aria-current={current ? "page" : undefined}
              nativeButton={false}
              render={<Link href={item.href} />}
            >
              {item.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="bg-primary/30" />
        <form action={signOutAction}>
          <DropdownMenuItem
            nativeButton
            className={itemClass}
            render={<button type="submit" />}
          >
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
