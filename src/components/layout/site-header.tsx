"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import type { SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const links = [
  { href: "/dashboard", label: "Home" },
  { href: "/decks", label: "Decks" },
  { href: "/friends", label: "Friends" },
  { href: "/favorites", label: "Favorites" },
  { href: "/profile", label: "Profile" },
];

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();
  // Open only for the path it was opened on, so a navigation closes it
  // without a setState effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const menuOpen = openPath === pathname;

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={user ? "/dashboard" : "/"} className="flex min-w-0 items-center">
          <Image
            src="/spellbranch-logo.png"
            alt="Spellbranch"
            width={1964}
            height={452}
            priority
            unoptimized
            className="h-8 w-auto max-w-[46vw] sm:h-10 sm:max-w-[220px]"
          />
        </Link>

        {user ? (
          <>
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-lg px-3 py-2 label-caps transition-colors",
                    pathname.startsWith(link.href)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="hidden items-center gap-3 md:flex">
              <span className="text-sm text-muted-foreground">
                {user.displayName}
              </span>
              <form action={signOutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            </div>
            <Sheet
              open={menuOpen}
              onOpenChange={(open) => setOpenPath(open ? pathname : null)}
            >
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" className="shrink-0 md:hidden" />
                }
              >
                <Menu className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px]">
                <SheetHeader>
                  <SheetTitle className="font-heading">Spellbranch</SheetTitle>
                </SheetHeader>
                <div className="mt-6 flex flex-col gap-2 px-2">
                  {links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpenPath(null)}
                      className={cn(
                        "rounded-lg px-3 py-3 text-sm font-medium",
                        pathname.startsWith(link.href)
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground",
                      )}
                    >
                      {link.label}
                    </Link>
                  ))}
                  <form action={signOutAction} className="mt-4">
                    <Button type="submit" variant="outline" className="w-full">
                      Sign out
                    </Button>
                  </form>
                </div>
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" render={<Link href="/login" />}>
              Sign in
            </Button>
            <Button render={<Link href="/signup" />}>Join free</Button>
          </div>
        )}
      </div>
    </header>
  );
}
