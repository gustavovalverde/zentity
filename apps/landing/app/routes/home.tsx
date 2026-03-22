import type { MetaFunction } from "react-router";

import { ComplianceStandards } from "@/components/landing/compliance-standards";
import { CTASection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { FourPillars } from "@/components/landing/four-pillars";
import { Hero } from "@/components/landing/hero";
import { Nav } from "@/components/landing/nav";
import { TechnicalDeepDive } from "@/components/landing/technical-deep-dive";
import { TrustEvidence } from "@/components/landing/trust-evidence";
import { UseCases } from "@/components/landing/use-cases";
import {
  FAQSchema,
  OrganizationSchema,
  SoftwareApplicationSchema,
} from "@/components/seo/json-ld";

export const meta: MetaFunction = () => [
  { title: "Zentity - Privacy-First Identity Verification" },
  {
    name: "description",
    content:
      "Privacy-first identity verification using zero-knowledge proofs, fully homomorphic encryption, post-quantum cryptography, and standards-based OAuth/OIDC integrations.",
  },
];

export default function HomePage() {
  return (
    <>
      <OrganizationSchema />
      <SoftwareApplicationSchema />
      <FAQSchema />

      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="-translate-y-full fixed top-2 left-2 z-60 rounded-md bg-background px-3 py-2 text-sm shadow transition-transform focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main-content">
          <Hero />
          <TrustEvidence />
          <FourPillars />
          <UseCases />
          <TechnicalDeepDive />
          <ComplianceStandards />
          <CTASection />
        </main>
        <Footer />
      </div>
    </>
  );
}
