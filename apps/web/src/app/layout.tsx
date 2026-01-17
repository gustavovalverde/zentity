import type { Metadata } from "next";

import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://zentity.xyz"
  ),
  title: "Zentity - Privacy-First Identity Verification",
  description:
    "Verify identity without exposing personal data using passkeys, zero-knowledge proofs, fully homomorphic encryption, and cryptographic commitments.",
  openGraph: {
    type: "website",
    siteName: "Zentity",
    title: "Zentity - Prove everything. Reveal nothing.",
    description:
      "Privacy-first identity verification using passkeys, zero-knowledge proofs, fully homomorphic encryption, and commitments.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Zentity - Prove everything. Reveal nothing.",
    description:
      "Privacy-first identity verification using passkeys, zero-knowledge proofs, fully homomorphic encryption, and commitments.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Cross-origin isolation (COEP/COOP) for SharedArrayBuffer is set via
            server-side headers in next.config.ts. This is required for WASM
            multi-threading (nested workers). Service worker approach doesn't work
            because it can't intercept nested worker requests.
            See: https://github.com/w3c/ServiceWorker/issues/1529 */}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          {/* Skip to main content link for keyboard users */}
          <a
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            href="#main-content"
          >
            Skip to main content
          </a>
          <main id="main-content">{children}</main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
