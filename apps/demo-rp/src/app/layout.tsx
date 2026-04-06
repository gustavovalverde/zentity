import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";

import { PrivacyToggle } from "@/components/privacy-toggle";
import { PrivacyModeProvider } from "@/components/providers/privacy-mode-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Zentity Demo RP",
  description:
    "Experience verified identity without the data risk. See how privacy-preserving identity verification works.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} antialiased`}
      >
        <PrivacyModeProvider>
          <TooltipProvider>
            {children}
            <PrivacyToggle />
          </TooltipProvider>
        </PrivacyModeProvider>
      </body>
    </html>
  );
}
