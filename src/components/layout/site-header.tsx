"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Menu, Search } from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { AccountMenu } from "@/components/layout/account-menu";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MAIN_NAV, MOBILE_MENU_NAV, mainNavActive, type MainNavHref } from "@/components/layout/main-nav";
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
  className,
}: {
  items: readonly { href: MainNavHref; label: string }[];
  pathname: string;
  section: string | null;
  onNavigate?: () => void;
  className: string;
}) {
  return (
    <>
      {items.map((link) => {
        const active = mainNavActive(pathname, link.href, section);
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
  const searchActive = mainNavActive(pathname, "/browse", section);

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
          <>
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
              <NavLinks
                items={MAIN_NAV}
                pathname={pathname}
                section={section}
                className={cn(
                  "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              />
            </nav>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href="/browse"
                aria-label="Search"
                aria-current={searchActive ? "page" : undefined}
                className={cn(
                  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  searchActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Search className="size-5" aria-hidden />
              </Link>
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
                    className="py-3 text-sm font-medium text-foreground"
                  />
                </nav>
              </SheetContent>
              </Sheet>
            </div>
          </>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
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
        )}
      </div>
    </header>
  );
}
