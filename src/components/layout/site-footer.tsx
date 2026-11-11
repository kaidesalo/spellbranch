import type { ReactNode } from "react";

// TODO: Kaide does not have Terms of Service, Privacy Policy, or social
// accounts for Spellbranch yet. Do not add those links or icons until the
// pages exist. Dead links are worse than a short footer.

function FooterLink({
  href,
  children,
  newTab = false,
}: {
  href: string;
  children: ReactNode;
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      className="text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground"
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/**
 * Site-wide footer. `revision` is a short commit id when the host provides
 * one (VERCEL_GIT_COMMIT_SHA). Omitted in local dev.
 */
export function SiteFooter({ revision }: { revision?: string | null }) {
  const build = revision?.trim();
  return (
    <footer data-testid="site-footer" className="border-t border-border/70 bg-background">
      <div className="mx-auto min-w-0 max-w-7xl space-y-3 px-4 py-8 text-xs leading-relaxed text-muted-foreground sm:px-6">
        <p>Spellbranch is currently in beta testing. Features may change and data may be reset.</p>
        <p>
          Spellbranch is unofficial Fan Content permitted under the{" "}
          <FooterLink href="https://company.wizards.com/en/legal/fancontentpolicy" newTab>
            Fan Content Policy
          </FooterLink>
          . Not approved/endorsed by Wizards. Portions of the materials used are property of
          Wizards of the Coast. ©Wizards of the Coast LLC. Magic: The Gathering and its logos are
          trademarks of Wizards of the Coast LLC.
        </p>
        <p>
          Card images and card data are provided by{" "}
          <FooterLink href="https://scryfall.com" newTab>
            Scryfall
          </FooterLink>
          . Spellbranch is not affiliated with Scryfall.
        </p>
        <p className="border-t border-border/60 pt-3">
          © 2026 Spellbranch · Created by{" "}
          <FooterLink href="https://vulpibyte.dev" newTab>
            vulpibyte.dev
          </FooterLink>{" "}
          · Beta
          {build ? ` · ${build}` : ""}
        </p>
      </div>
    </footer>
  );
}

/** First 7 characters of the Vercel commit, or null when the build has none. */
export function footerRevision(env: Record<string, string | undefined> = process.env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (!sha) return null;
  return sha.slice(0, 7);
}
