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
  const coopHeader =
    process.env.NEXT_PUBLIC_COOP === "same-origin-allow-popups" ||
    process.env.NEXT_PUBLIC_COOP === "unsafe-none"
      ? process.env.NEXT_PUBLIC_COOP
      : "same-origin";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Enable cross-origin isolation for SharedArrayBuffer (ZK proofs).
            Service worker intercepts ALL requests and adds COEP/COOP headers.
            First visit triggers a reload to activate the SW.
            Must be a raw script tag - Next.js Script component doesn't work
            correctly with service worker self-registration. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.coi = Object.assign({}, window.coi, { coop: ${JSON.stringify(
              coopHeader
            )} });`,
          }}
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/coi-serviceworker.js" />
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
