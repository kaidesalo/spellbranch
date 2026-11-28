"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { mainNavActive, type MainNavHref } from "@/components/layout/main-nav";
import { DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const navLinkClass =
  "rounded-lg px-3 py-2 label-caps transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function NavLinks({
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
