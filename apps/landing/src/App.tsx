import { Navigate, Route, Routes } from "react-router-dom";

import { DocsLayout } from "@/components/docs/docs-layout";
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
import { ThemeProvider } from "@/lib/theme";
import { useDocumentHead } from "@/lib/use-document-head";
import { useHashAnchorScroll } from "@/lib/use-hash-anchor-scroll";
import { DocsPage } from "@/pages/docs-page";
import { PrivacyPage, TermsPage } from "@/pages/legal-pages";
import { WhitepaperPage } from "@/pages/whitepaper-page";
import { ZkAuthPage } from "@/pages/zk-auth-page";

function LandingPage() {
  useDocumentHead({
    title: "Zentity - Privacy-First Identity Verification",
    description:
      "Privacy-first identity verification using passkeys, zero-knowledge proofs, and standards-based OAuth/OIDC integrations.",
  });

  return (
    <>
      {/* JSON-LD Structured Data for SEO */}
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

function App() {
  useHashAnchorScroll();

  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/docs"
          element={<Navigate to="/docs/architecture" replace />}
        />
        <Route
          path="/docs/:slug"
          element={
            <DocsLayout>
              <DocsPage />
            </DocsLayout>
          }
        />
        <Route
          path="/compliance"
          element={<Navigate to="/#compliance" replace />}
        />
        <Route
          path="/interoperability"
          element={<Navigate to="/#compliance" replace />}
        />
        <Route
          path="/go-live"
          element={<Navigate to="/docs/oauth-integrations" replace />}
        />
        <Route path="/whitepaper" element={<WhitepaperPage />} />
        <Route path="/zk-auth" element={<ZkAuthPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    </ThemeProvider>
  );
}

export default App;
