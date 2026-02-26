import type { ReactNode } from "react";

import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { useDocumentHead } from "@/lib/use-document-head";

interface LegalLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
}

function LegalLayout({ title, description, children }: LegalLayoutProps) {
  useDocumentHead({
    title: `${title} | Zentity`,
    description,
  });

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="-translate-y-full fixed top-2 left-2 z-[60] rounded-md bg-background px-3 py-2 text-sm shadow transition-transform focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to content
      </a>
      <Nav />
      <main
        id="main-content"
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-24"
      >
        <article className="rounded-lg border border-border bg-card p-6 md:p-8">
          <h1 className="font-display font-semibold text-3xl leading-tight">
            {title}
          </h1>
          <div className="landing-copy mt-6 space-y-4">{children}</div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      description="How Zentity handles data in the public demo and documentation site."
    >
      <p>Last updated: February 25, 2026.</p>
      <p>
        Zentity is an active proof-of-concept project. We design flows to
        minimize plaintext personal data exposure and avoid storing raw document
        images or selfies after verification processing.
      </p>
      <p>
        For the landing site itself, analytics and tracking are intentionally
        minimal. For the product demo, handling of identity and cryptographic
        artifacts follows the architecture and trust-boundary documentation in
        the docs section.
      </p>
      <p>
        If you need a signed enterprise privacy agreement or DPA, contact{" "}
        <a
          href="mailto:hello@zentity.xyz"
          className="underline underline-offset-4"
        >
          hello@zentity.xyz
        </a>
        .
      </p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      description="Terms for evaluating the Zentity landing site and public demo."
    >
      <p>Last updated: February 25, 2026.</p>
      <p>
        Zentity is provided as an alpha proof-of-concept for evaluation and
        research. It is not represented as production-ready identity
        infrastructure.
      </p>
      <p>
        The source code is available under the{" "}
        <a
          href="https://osaasy.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          O&apos;Saasy License
        </a>
        . Use of the software and derivatives is governed by that license.
      </p>
      <p>
        For commercial usage terms, integrations, or enterprise agreements,
        contact{" "}
        <a
          href="mailto:hello@zentity.xyz"
          className="underline underline-offset-4"
        >
          hello@zentity.xyz
        </a>
        .
      </p>
    </LegalLayout>
  );
}
