/**
 * Signed-in primary navigation. Favorites and Profile stay reachable from
 * the account cluster in the header; they are not top-level items.
 *
 * Decks is /decks (your decks and public decks). Collection is only the
 * owned-cards tab on /my-cards. A deck page still highlights Decks.
 */
export const MAIN_NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/browse", label: "Search" },
  { href: "/my-cards?section=collection", label: "Collection" },
  { href: "/decks", label: "Decks" },
  { href: "/friends", label: "Social" },
] as const;

/** Hamburger list. Search lives in the mobile header icon instead. */
export const MOBILE_MENU_NAV = MAIN_NAV.filter((item) => item.href !== "/browse");

export type MainNavHref = (typeof MAIN_NAV)[number]["href"];

/** True when this primary item should show as the current section. */
export function mainNavActive(
  pathname: string,
  href: MainNavHref,
  section?: string | null,
): boolean {
  if (href === "/decks") {
    return pathname === "/decks" || pathname.startsWith("/decks/") || pathname.startsWith("/decks?");
  }
  if (href === "/my-cards?section=collection") {
    return pathname === "/my-cards" && section === "collection";
  }
  return pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`);
}
