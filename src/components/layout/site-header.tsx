"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Search } from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { AccountMenu } from "@/components/layout/account-menu";
import { MAIN_NAV, mainNavActive } from "@/components/layout/main-nav";
import { MobileHeaderMenu } from "@/components/layout/mobile-header-menu";
import { NavLinks } from "@/components/layout/nav-links";
import { SearchDialog } from "@/components/layout/search-dialog";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";

const searchButtonClass = (active: boolean, signedIn: boolean) =>
  cn(
    "inline-flex size-11 shrink-0 items-center justify-center rounded-lg",
    signedIn && "md:hidden",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "aria-expanded:bg-primary aria-expanded:text-primary-foreground",
    active
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
  );

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();
  const section = useSearchParams().get("section");
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
        <Link href={user ? "/dashboard" : "/"} className="flex min-w-0 items-center overflow-hidden">
          <Image
            src="/spellbranch-logo.png"
            alt="Spellbranch"
            width={1958}
            height={449}
            priority
            unoptimized
            className="site-logo h-8 w-auto max-w-full sm:h-10 sm:max-w-[220px]"
          />
        </Link>

        <Dialog open={searchOpen} onOpenChange={onSearchOpenChange}>
          {user ? (
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
              <NavLinks
                items={MAIN_NAV}
                pathname={pathname}
                section={section}
                onSearch={rememberSearchOpener}
                className="text-muted-foreground hover:bg-secondary hover:text-foreground"
              />
            </nav>
          ) : null}
          <div className={cn("flex shrink-0 items-center", user ? "gap-1" : "gap-2")}>
            <ThemeToggle />
            <DialogTrigger
              render={
                <button
                  type="button"
                  aria-label="Search"
                  aria-current={searchActive ? "page" : undefined}
                  onClick={rememberSearchOpener}
                  className={searchButtonClass(searchActive, user !== null)}
                />
              }
            >
              <Search className="size-5" aria-hidden />
            </DialogTrigger>
            {user ? (
              <AccountMenu user={user} />
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="hidden md:inline-flex"
                  render={<Link href="/login" />}
                >
                  Sign in
                </Button>
                <Button className="hidden md:inline-flex" render={<Link href="/signup" />}>
                  Join free
                </Button>
              </>
            )}
            <MobileHeaderMenu user={user} pathname={pathname} section={section} />
          </div>
          <SearchDialog open={searchOpen} />
        </Dialog>
      </div>
    </header>
  );
}
