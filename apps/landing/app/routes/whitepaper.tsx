import { whitepaper } from "virtual:markdown-content";
import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { BreachTimeline } from "@/components/docs/breach-timeline";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";

export const meta: MetaFunction = () => [
  {
    title:
      "White Paper — Identity Verification Without Data Collection | Zentity",
  },
  {
    name: "description",
    content:
      "How cryptographic architecture eliminates the need to store personal data for compliance. A technical white paper on zero-knowledge proofs, FHE, and credential-derived key custody.",
  },
];

export async function loader() {
  const stripped = whitepaper.replace(/^#[^\n]*\n\n\*\*[^\n]*\*\*\n\n/, "");
  const [beforeTimeline, timelineMarkdown, afterTimeline] = stripped.split(
    /<!--\s*\/?BREACH_TIMELINE\s*-->/,
  );
  return { beforeTimeline, timelineMarkdown, afterTimeline };
}

export default function WhitepaperPage() {
  const { beforeTimeline, timelineMarkdown, afterTimeline } =
    useLoaderData<typeof loader>();

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
