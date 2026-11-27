"use client";

import type { PropsWithChildren } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Applies the saved color mode before paint. next-themes renders a blocking
 * inline script as its first child (class on <html>, localStorage key below).
 * The root layout must render this provider before the splash and the page,
 * and <html> needs suppressHydrationWarning because that script edits the
 * class ahead of hydration.
 */
export function ThemeProvider({ children, nonce }: PropsWithChildren<{ nonce?: string }>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
