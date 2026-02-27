import { BreachTimeline } from "@/components/docs/breach-timeline";
import { MarkdownRenderer } from "@/components/docs/markdown-renderer";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { Badge } from "@/components/ui/badge";
import { useDocumentHead } from "@/lib/use-document-head";

import rawContent from "../../../../docs/papers/whitepapers/verification-without-collection/WHITEPAPER.md?raw";

// Strip the title + subtitle preamble — rendered by the page header instead
const stripped = rawContent.replace(/^#[^\n]*\n\n\*\*[^\n]*\*\*\n\n/, "");

// Split around the breach timeline markers — the bullet list is parsed into a
// visual React component while the markdown file stays the single source of truth
const [beforeTimeline, timelineMarkdown, afterTimeline] = stripped.split(
  /<!--\s*\/?BREACH_TIMELINE\s*-->/,
);

export function WhitepaperPage() {
  useDocumentHead({
    title:
      "White Paper — Identity Verification Without Data Collection | Zentity",
    description:
      "How cryptographic architecture eliminates the need to store personal data for compliance. A technical white paper on zero-knowledge proofs, FHE, and credential-derived key custody.",
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
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-24 md:py-28"
      >
        <header className="mb-10">
          <Badge variant="outline" className="mb-4">
            White Paper
          </Badge>
          <h1 className="font-display font-semibold text-3xl leading-tight sm:text-4xl">
            Identity Verification Without Data Collection
          </h1>
          <p className="landing-copy mt-3">
            How cryptographic architecture eliminates the need to store personal
            data for compliance
          </p>
        </header>
        <MarkdownRenderer content={beforeTimeline.trim()} />
        <BreachTimeline markdown={timelineMarkdown} className="my-8" />
        <MarkdownRenderer content={afterTimeline.trim()} />
      </main>
      <Footer />
    </div>
  );
}
