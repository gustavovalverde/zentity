import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { MarkdownRenderer } from "@/components/markdown-renderer";

export function stripH1(md: string): string {
  return md.replace(/^#\s+[^\n]*\n+/, "");
}

interface LegalLayoutProps {
  title: string;
  content: string;
}

export function LegalLayout({ title, content }: LegalLayoutProps) {
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
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-24"
      >
        <article className="rounded-lg border border-border bg-card p-6 md:p-8">
          <h1 className="font-display font-semibold text-3xl leading-tight">
            {title}
          </h1>
          <div className="landing-copy mt-6">
            <MarkdownRenderer content={content} />
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
