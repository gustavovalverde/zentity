import { RootProvider } from "fumadocs-ui/provider/react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Zentity - Privacy-First Identity Verification</title>
        <meta
          name="description"
          content="Verify identity without storing PII. Zero-knowledge proofs and homomorphic encryption for private KYC. Open source, self-hostable."
        />
        <meta
          name="keywords"
          content="KYC, identity verification, zero-knowledge proofs, privacy, FHE, homomorphic encryption, open source"
        />

        {/* Favicons */}
        <link rel="icon" type="image/svg+xml" href="/images/logo/icon.svg" />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/images/logo/icon-32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/images/logo/icon-16.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/images/logo/apple-touch-icon.png"
        />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Zentity" />
        <meta
          property="og:title"
          content="Zentity - Prove everything. Reveal nothing."
        />
        <meta
          property="og:description"
          content="Privacy-first KYC using zero-knowledge proofs. Verify identity without storing personal data."
        />
        <meta property="og:url" content="https://zentity.xyz" />
        <meta
          property="og:image"
          content="https://zentity.xyz/images/og-image.png"
        />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="Zentity - Prove everything. Reveal nothing."
        />
        <meta
          name="twitter:description"
          content="Privacy-first KYC using zero-knowledge proofs. Verify identity without storing personal data."
        />
        <meta
          name="twitter:image"
          content="https://zentity.xyz/images/og-image.png"
        />

        <Meta />
        <Links />

        {/* Smooth scroll */}
        <style>{"html { scroll-behavior: smooth; }"}</style>
      </head>
      <body className="antialiased">
        <RootProvider>{children}</RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}
