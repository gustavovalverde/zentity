import type { Metadata } from "next";

import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";

import { Web3Provider } from "@/components/providers/web3-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { auth } from "@/lib/auth/auth";
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
    process.env.NEXT_PUBLIC_APP_URL || "https://zentity.xyz",
  ),
  title: "Zentity - Privacy-First Identity Verification",
  description:
    "Verify your identity without exposing personal data using zero-knowledge proofs and homomorphic encryption.",
  openGraph: {
    type: "website",
    siteName: "Zentity",
    title: "Zentity - Prove everything. Reveal nothing.",
    description:
      "Privacy-first identity verification using zero-knowledge proofs. Verify without storing personal data.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Zentity - Prove everything. Reveal nothing.",
    description:
      "Privacy-first identity verification using zero-knowledge proofs. Verify without storing personal data.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Get cookies for SSR hydration of wallet state
  const headersObj = await headers();
  const cookies = headersObj.get("cookie");
  const session = await auth.api.getSession({ headers: headersObj });
  const walletScopeId = session?.user?.id ?? null;
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
              coopHeader,
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
          enableSystem
          disableTransitionOnChange
        >
          <Web3Provider cookies={cookies} walletScopeId={walletScopeId}>
            {/* Skip to main content link for keyboard users */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:ring-2 focus:ring-ring focus:rounded-md focus:outline-none"
            >
              Skip to main content
            </a>
            <main id="main-content">{children}</main>
            <Toaster />
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
