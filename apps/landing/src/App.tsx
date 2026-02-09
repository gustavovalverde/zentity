import { Route, Routes } from "react-router-dom";

import {
  CTASection,
  FeaturesGrid,
  Footer,
  FourPillars,
  Hero,
  MidPageCTA,
  Nav,
  PocDisclaimer,
  ProblemSolution,
  TechnicalDeepDive,
  UseCases,
} from "@/components/landing";
import {
  FAQSchema,
  OrganizationSchema,
  SoftwareApplicationSchema,
} from "@/components/seo/json-ld";
import { ThemeProvider } from "@/lib/theme";

function LandingPage() {
  return (
    <>
      {/* JSON-LD Structured Data for SEO */}
      <OrganizationSchema />
      <SoftwareApplicationSchema />
      <FAQSchema />

      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <Nav />
        <main>
          <Hero />
          <ProblemSolution />
          <FourPillars />
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
      </Routes>
    </ThemeProvider>
  );
}

export default App;
