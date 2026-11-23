import type { ReactNode } from "react";
import { releaseDisclaimer, releaseLabel, showCommit, type ReleaseEnv } from "@/lib/release-label";

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
 *
 * The release label, the beta disclaimer, and whether to show the commit id
 * all come from `@/lib/release-label`. Production shows "v1.0", drops the
 * disclaimer, and omits the commit id. Every other environment keeps "Beta",
 * the disclaimer, and the commit id when one is present.
 */
export function SiteFooter({
  revision,
  env = process.env,
}: {
  revision?: string | null;
  env?: ReleaseEnv;
}) {
  const build = revision?.trim();
  const label = releaseLabel(env);
  const disclaimer = releaseDisclaimer(env);
  const commit = showCommit(env) && build ? ` · ${build}` : "";
  return (
    <footer data-testid="site-footer" className="border-t border-border/70 bg-background">
      <div className="mx-auto min-w-0 max-w-7xl space-y-3 px-4 py-8 text-xs leading-relaxed text-muted-foreground sm:px-6">
        {disclaimer ? <p>{disclaimer}</p> : null}
        <p data-testid="fan-content-disclaimer" className="max-w-full break-words">
          Spellbranch is unofficial Fan Content permitted under the{" "}
          <FooterLink href="https://company.wizards.com/en/legal/fancontentpolicy" newTab>
            Fan Content Policy
          </FooterLink>
          . Not approved/endorsed by Wizards. Portions of the materials used are property of
          Wizards of the Coast. ©Wizards of the Coast LLC.
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
          · {label}
          {commit}
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
