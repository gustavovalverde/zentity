import { Navigate, Route, Routes } from "react-router-dom";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  CTASection,
  FeaturesGrid,
  Footer,
  Hero,
  MidPageCTA,
  Nav,
  PocDisclaimer,
  ProblemSolution,
  TechnicalDeepDive,
  ThreePillars,
  UseCases,
} from "@/components/landing";
import {
  FAQSchema,
  OrganizationSchema,
  SoftwareApplicationSchema,
} from "@/components/seo/json-ld";
import { ThemeProvider } from "@/lib/theme";
import { DocsPage } from "@/pages/docs-page";

function LandingPage() {
  return (
    <>
      {/* JSON-LD Structured Data for SEO */}
      <OrganizationSchema />
      <SoftwareApplicationSchema />
      <FAQSchema />

      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <Nav />
        <main>
          <Hero />
          <ProblemSolution />
          <ThreePillars />
          <UseCases />
          <MidPageCTA />
          <FeaturesGrid />
          <TechnicalDeepDive />
          <CTASection />
          <PocDisclaimer />
        </main>
        <Footer />
      </div>
    </>
  );
}

export function App() {
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
      </Routes>
    </ThemeProvider>
  );
}

export default App;
