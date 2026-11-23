"use client";

import { useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Menu, Search } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import type { SessionUser } from "@/lib/types";
import { AccountMenu, accountMenuItems } from "@/components/layout/account-menu";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MAIN_NAV, MOBILE_MENU_NAV, mainNavActive, type MainNavHref } from "@/components/layout/main-nav";
import { SearchDialog } from "@/components/layout/search-dialog";
import {
  Dialog,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navLinkClass =
  "rounded-lg px-3 py-2 label-caps transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function NavLinks({
  items,
  pathname,
  section,
  onNavigate,
  onSearch,
  className,
}: {
  items: readonly { href: MainNavHref; label: string }[];
  pathname: string;
  section: string | null;
  onNavigate?: () => void;
  onSearch?: (event: MouseEvent<HTMLButtonElement>) => void;
  className: string;
}) {
  return (
    <>
      {items.map((link) => {
        const active = mainNavActive(pathname, link.href, section);
        if (link.href === "/browse" && onSearch) {
          return (
            <DialogTrigger
              key={link.href}
              render={
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={onSearch}
                  className={cn(
                    navLinkClass,
                    className,
                    "aria-expanded:bg-primary aria-expanded:text-primary-foreground",
                    active && "bg-primary text-primary-foreground",
                  )}
                />
              }
            >
              {link.label}
            </DialogTrigger>
          );
        }
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(navLinkClass, className, active && "bg-primary text-primary-foreground")}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();
  const section = useSearchParams().get("section");
  // Open only for the path it was opened on, so a navigation closes it
  // without a setState effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const menuOpen = openPath === pathname;
  const searchActive =
    mainNavActive(pathname, "/browse", section) ||
    pathname === "/search" ||
    pathname.startsWith("/search/");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpener = useRef<HTMLElement | null>(null);

  function rememberSearchOpener(event: { currentTarget: HTMLElement }) {
    searchOpener.current = event.currentTarget;
  }

  function onSearchOpenChange(open: boolean) {
    setSearchOpen(open);
    if (!open) {
      const opener = searchOpener.current;
      queueMicrotask(() => opener?.focus());
    }
  }

  return (
    <header className="sticky top-0 z-40 min-w-0 border-b border-border/70 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 min-w-0 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={user ? "/dashboard" : "/"} className="flex min-w-0 items-center">
          <Image
            src="/spellbranch-logo.png"
            alt="Spellbranch"
            width={1958}
            height={449}
            priority
            unoptimized
            className="h-8 w-auto max-w-[46vw] sm:h-10 sm:max-w-[220px]"
          />
        </Link>

        {user ? (
          <Dialog open={searchOpen} onOpenChange={onSearchOpenChange}>
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
              <NavLinks
                items={MAIN_NAV}
                pathname={pathname}
                section={section}
                onSearch={rememberSearchOpener}
                className={cn(
                  "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              />
            </nav>
            <div className="flex shrink-0 items-center gap-1">
              <DialogTrigger
                render={
                  <button
                    type="button"
                    aria-label="Search"
                    aria-current={searchActive ? "page" : undefined}
                    onClick={rememberSearchOpener}
                    className={cn(
                      "inline-flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      "aria-expanded:bg-primary aria-expanded:text-primary-foreground",
                      searchActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  />
                }
              >
                <Search className="size-5" aria-hidden />
              </DialogTrigger>
              <AccountMenu user={user} />
              <Sheet
                open={menuOpen}
                onOpenChange={(open) => setOpenPath(open ? pathname : null)}
              >
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" className="size-11 shrink-0 md:hidden" />
                }
              >
                <Menu className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px]">
                <SheetHeader>
                  <SheetTitle className="font-display font-semibold">Spellbranch</SheetTitle>
                </SheetHeader>
                <nav aria-label="Main" className="mt-6 flex flex-col gap-2 px-2">
                  <NavLinks
                    items={MOBILE_MENU_NAV}
                    pathname={pathname}
                    section={section}
                    onNavigate={() => setOpenPath(null)}
                    className="min-h-11 py-3 text-sm font-medium text-foreground"
                  />
                </nav>
                <section
                  aria-labelledby="mobile-profile-heading"
                  className="mt-2 border-t border-border px-2 pt-4 md:hidden"
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
                          onClick={() => setOpenPath(null)}
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
                  <form action={signOutAction} className="px-2 pb-4">
                    <Button type="submit" variant="outline" className="h-11 w-full">
                      Sign out
                    </Button>
                  </form>
                </section>
              </SheetContent>
              </Sheet>
            </div>
            <SearchDialog open={searchOpen} />
          </Dialog>
        ) : (
          <Dialog open={searchOpen} onOpenChange={onSearchOpenChange}>
            <div className="flex shrink-0 items-center gap-2">
              <DialogTrigger
                render={
                  <button
                    type="button"
                    aria-label="Search"
                    aria-current={searchActive ? "page" : undefined}
                    onClick={rememberSearchOpener}
                    className={cn(
                      "inline-flex size-11 shrink-0 items-center justify-center rounded-lg",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      "aria-expanded:bg-primary aria-expanded:text-primary-foreground",
                      searchActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  />
                }
              >
                <Search className="size-5" aria-hidden />
              </DialogTrigger>
              <Button
                variant="ghost"
                className="max-sm:px-2! max-sm:tracking-normal!"
                render={<Link href="/login" />}
              >
                Sign in
              </Button>
              <Button className="max-sm:px-2! max-sm:tracking-normal!" render={<Link href="/signup" />}>
                Join free
              </Button>
            </div>
            <SearchDialog open={searchOpen} />
          </Dialog>
        )}
      </div>
    </header>
  );
}
