import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Cinzel, Geist_Mono, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter, footerRevision } from "@/components/layout/site-footer";
import { BootReady, BootSplashGate } from "@/components/layout/boot-splash";
import { SPLASH_START_SCRIPT } from "@/components/layout/boot-splash-timing";
import { getSessionUser } from "@/lib/auth/session";
import "./globals.css";
import "./boot-splash.css";

// UI, card text, and counts. Inter is a variable font, so 400/500/600 come
// from font-weight. A weight array makes Google Fonts sometimes answer with
// extensionless /l/font?kit= URLs, and Next 16.4.2 fails the production build
// on those (`next/font/google queries have exactly one entry`).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Wordmark and deck titles only. 600 is a real Cinzel cut, not a synthesized bold.
const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: "600",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spellbranch — Social MTG Deck Building",
  description:
    "Build Magic: The Gathering decks with friends, fork branches, and compare versions side by side.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Proxy forwards the CSP nonce. The stamp has to run as the body is parsed,
  // before paint; a missing nonce just means the effect stamps on hydrate.
  const nonce = (await headers()).get("x-nonce");

  return (
    <html
      lang="en"
      className={`${inter.variable} ${cinzel.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh min-w-0 flex-col">
        <script
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{ __html: SPLASH_START_SCRIPT }}
        />
        <BootSplashGate>
          {/* Session and the page stream in behind the splash. Client
              navigations are transitions, so this fallback does not replace
              a page that is already on screen. */}
          <Suspense fallback={null}>
            <AppBody>{children}</AppBody>
          </Suspense>
        </BootSplashGate>
      </body>
    </html>
  );
}

async function AppBody({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <>
      <SiteHeader user={user} />
      {/* clip is a backstop. The deck page itself has to fit the viewport.
          flex-1 lets a short page fill the screen so the footer sits at the bottom. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip">{children}</main>
      <SiteFooter revision={footerRevision()} />
      <Toaster richColors position="top-center" />
      <BootReady />
    </>
  );
}
