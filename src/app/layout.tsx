import type { Metadata } from "next";
import { Cinzel, Geist_Mono, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/layout/site-header";
import { getSessionUser } from "@/lib/auth/session";
import "./globals.css";

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
  const user = await getSessionUser();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${cinzel.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full min-w-0 flex-col">
        <SiteHeader user={user} />
        {/* clip is a backstop. The deck page itself has to fit the viewport. */}
        <main className="min-w-0 flex-1 overflow-x-clip">{children}</main>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
