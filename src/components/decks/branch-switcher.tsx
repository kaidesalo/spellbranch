"use client";

import Link from "next/link";
import { Check, ChevronDown, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BranchOption } from "@/lib/branch-switcher";

/**
 * Dropdown of the source deck and the branches the viewer can see.
 * Choosing a row opens that deck. Each branch keeps a diff link (the old
 * per-chip "diff"), and one more sits beside the closed menu.
 */
export function BranchSwitcher({
  currentId,
  options,
  diffHref,
}: {
  currentId: string;
  options: BranchOption[];
  diffHref: string | null;
}) {
  const current = options.find((option) => option.id === currentId) ?? options[0];
  if (!current) return null;

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 sm:mt-4 sm:px-4 sm:py-3">
      <p id="branch-switcher-label" className="text-sm font-medium">
        Branches
      </p>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-labelledby="branch-switcher-label"
            className="flex h-11 min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm outline-none hover:border-primary/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <GitBranch className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              {current.name}
              {current.username ? (
                <span className="text-muted-foreground"> @{current.username}</span>
              ) : null}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--anchor-width) min-w-0 max-w-[calc(100vw-2rem)]"
          >
            {options.map((option) => (
              <div key={option.id} className="flex items-stretch gap-0.5">
                <DropdownMenuItem
                  className="min-h-11 min-w-0 flex-1 py-2"
                  {...(option.openHref === null
                    ? {}
                    : { render: <Link href={option.openHref ?? `/decks/${option.id}`} /> })}
                >
                  {option.id === currentId ? (
                    <Check className="text-primary" aria-hidden />
                  ) : (
                    <GitBranch className="text-muted-foreground" aria-hidden />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="w-full truncate">{option.name}</span>
                    <span className="flex max-w-full flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {option.role === "copy" && option.username ? (
                        <span className="truncate">Copy by @{option.username}</span>
                      ) : option.username ? (
                        <span className="truncate">@{option.username}</span>
                      ) : null}
                      {option.role === "source" ? (
                        <Badge variant="outline">Main</Badge>
                      ) : null}
                      {option.role === "copy" ? <Badge variant="outline">Copy</Badge> : null}
                      {option.role === "original" ? (
                        <Badge variant="outline">Original</Badge>
                      ) : null}
                      {option.preferred ? <Badge>Preferred</Badge> : null}
                    </span>
                  </span>
                </DropdownMenuItem>
                {option.diffHref ? (
                  <DropdownMenuItem
                    className="min-h-11 shrink-0 px-2.5 text-xs text-primary"
                    aria-label={`Diff ${option.name}`}
                    render={<Link href={option.diffHref} />}
                  >
                    diff
                  </DropdownMenuItem>
                ) : null}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {diffHref ? (
          <Link
            href={diffHref}
            className="shrink-0 px-1 text-xs text-primary underline-offset-4 hover:underline"
          >
            diff
          </Link>
        ) : null}
      </div>
    </div>
  );
}
