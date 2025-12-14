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
    "Verify your identity without exposing personal data using zero-knowledge proofs and homomorphic encryption.",
  openGraph: {
    type: "website",
    siteName: "Zentity",
    title: "Zentity - Prove everything. Reveal nothing.",
    description:
      "Privacy-first KYC using zero-knowledge proofs. Verify identity without storing personal data.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Zentity - Prove everything. Reveal nothing.",
    description:
      "Privacy-first KYC using zero-knowledge proofs. Verify identity without storing personal data.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Skip to main content link for keyboard users */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:ring-2 focus:ring-ring focus:rounded-md focus:outline-none"
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
