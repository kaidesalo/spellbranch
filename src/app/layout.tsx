import type { Metadata } from "next";
import { Raleway, Knewave, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/layout/site-header";
import { getSessionUser } from "@/lib/auth/session";
import "./globals.css";

// Body, nav and labels: light geometric sans (variable font, 100-900).
const raleway = Raleway({
  variable: "--font-raleway",
  subsets: ["latin"],
});

// Page titles and section headers only (h1/h2, .font-heading): brush display face.
const knewave = Knewave({
  variable: "--font-knewave",
  weight: "400",
  subsets: ["latin"],
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
      className={`${raleway.variable} ${knewave.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader user={user} />
        <main className="flex-1">{children}</main>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
