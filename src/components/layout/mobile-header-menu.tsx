"use client";

import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { accountMenuItems } from "@/components/layout/account-menu";
import { MOBILE_MENU_NAV } from "@/components/layout/main-nav";
import { NavLinks } from "@/components/layout/nav-links";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ThemeRadiogroup } from "@/components/theme/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import type { SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

function focusWithRing(element: HTMLElement) {
  const options = { preventScroll: true, focusVisible: true } as FocusOptions;
  try {
    element.focus(options);
  } catch {
    element.focus();
  }
}

/**
 * Phone header menu. Below `md` the bar keeps the logo, search, and this
 * button. Color mode, sign-in, and the signed-in nav live in the dropdown.
 * Desktop (`md` and up) hides the whole control; the inline header stays.
 *
 * Open state is the path it was opened on. A route change closes it, and
 * clearing that path means coming back does not open it again.
 */
export function MobileHeaderMenu({
  user,
  pathname,
  section,
}: {
  user: SessionUser | null;
  pathname: string;
  section: string | null;
}) {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  if (openedAt !== null && openedAt !== pathname) {
    setOpenedAt(null);
  }
  const open = openedAt === pathname;

  function close() {
    setOpenedAt(null);
  }

  function toggle() {
    setOpenedAt(open ? null : pathname);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenedAt(null);
      buttonRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpenedAt(null);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    if (first) focusWithRing(first);
  }, [open]);

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!open) return;
    const next = event.relatedTarget;
    if (!(next instanceof Node)) return;
    if (event.currentTarget.contains(next)) return;
    setOpenedAt(null);
  }

  return (
    <div className="relative flex shrink-0 md:hidden" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden",
          "text-muted-foreground hover:bg-secondary hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "aria-expanded:bg-primary aria-expanded:text-primary-foreground",
        )}
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>
      <div
        ref={panelRef}
        id={menuId}
        role="region"
        aria-label="Menu"
        hidden={!open}
        tabIndex={-1}
        className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100dvh-4.5rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg focus-visible:outline-none"
      >
        {user ? (
          <nav aria-label="Main" className="flex flex-col gap-1">
            <NavLinks
              items={MOBILE_MENU_NAV}
              pathname={pathname}
              section={section}
              onNavigate={close}
              className="min-h-11 py-3 text-sm font-medium text-foreground"
            />
          </nav>
        ) : null}
        <section
          aria-labelledby="mobile-color-heading"
          className={cn("px-1", user && "mt-2 border-t border-border pt-3")}
        >
          <h2 id="mobile-color-heading" className="label-caps px-3 text-primary">
            Color mode
          </h2>
          <ThemeRadiogroup
            labelledBy="mobile-color-heading"
            showLabels
            align="start"
            className="mt-2 flex w-full flex-col items-stretch gap-0.5"
          />
        </section>
        {user ? (
          <section
            aria-labelledby="mobile-profile-heading"
            className="mt-2 border-t border-border px-1 pt-3 md:hidden"
          >
            <h2 id="mobile-profile-heading" className="label-caps px-3 text-primary">
              Profile & settings
            </h2>
            <div className="mt-3 flex min-w-0 items-center gap-3 px-3">
              <ProfileAvatar
                avatarPreset={user.avatarPreset}
                avatarUrl={user.avatarUrl}
                displayName={user.displayName}
                username={user.username}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{user.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-col">
              {accountMenuItems(user.username).map((item) => {
                const current = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    onClick={close}
                    className={cn(
                      "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      current && "bg-primary text-primary-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="my-3 border-t border-border" />
            <form action={signOutAction} className="px-1 pb-1">
              <Button type="submit" variant="outline" className="h-11 w-full">
                Sign out
              </Button>
            </form>
          </section>
        ) : (
          <div className="mt-2 flex flex-col gap-2 border-t border-border px-1 pt-3">
            <Link
              href="/login"
              onClick={close}
              className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")}
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              onClick={close}
              className={cn(buttonVariants(), "h-11 w-full")}
            >
              Join free
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
