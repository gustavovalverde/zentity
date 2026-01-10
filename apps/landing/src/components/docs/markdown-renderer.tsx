import { lazy, Suspense } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { getAllDocSlugs } from "@/content/docs";

// Lazy load Mermaid to avoid 1.5MB bundle hit on initial load
const MermaidBlock = lazy(() => import("./mermaid-block"));

// Transform markdown links to work with our docs routing
function transformHref(href: string | undefined): {
  href: string;
  isInternal: boolean;
  isExternal: boolean;
} {
  if (!href) return { href: "#", isInternal: false, isExternal: false };

  // External links (http/https)
  if (href.startsWith("http")) {
    return { href, isInternal: false, isExternal: true };
  }

  // Markdown file links (e.g., "zk-architecture.md" or "../README.md")
  if (href.endsWith(".md")) {
    let normalized = href;

    // Normalize "./" and "../" prefixes to resolve against docs root
    normalized = normalized.replace(/^\.\/+/, "");
    while (normalized.startsWith("../")) {
      normalized = normalized.slice(3);
    }

    // Strip leading "docs/" when linking from README or other files
    if (normalized.startsWith("docs/")) {
      normalized = normalized.slice(5);
    }

    // Special-case root README
    if (normalized.toLowerCase() === "readme.md") {
      return {
        href: "https://github.com/gustavovalverde/zentity/blob/main/README.md",
        isInternal: false,
        isExternal: true,
      };
    }

    // Transform "filename.md" to "/docs/filename"
    const slug = normalized.replace(/\.md$/, "");
    const availableSlugs = getAllDocSlugs();

    // Only link if the doc exists in our system
    if (availableSlugs.includes(slug)) {
      return { href: `/docs/${slug}`, isInternal: true, isExternal: false };
    }

    // Doc doesn't exist - link to GitHub docs folder
    return {
      href: `https://github.com/gustavovalverde/zentity/blob/main/docs/${normalized}`,
      isInternal: false,
      isExternal: true,
    };
  }

  // Anchor links or other relative paths
  return { href, isInternal: false, isExternal: false };
}

interface MarkdownRendererProps {
  content: string;
}

// Custom components following shadcn typography patterns
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-6 scroll-m-20 text-balance font-extrabold text-4xl tracking-tight">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 mb-4 scroll-m-20 border-b pb-2 font-semibold text-3xl tracking-tight transition-colors first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 mb-4 scroll-m-20 font-semibold text-2xl tracking-tight">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-6 mb-2 scroll-m-20 font-semibold text-xl tracking-tight">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="leading-7 [&:not(:first-child)]:mt-6">{children}</p>
  ),
  a: ({ href, children }) => {
    const {
      href: transformedHref,
      isInternal,
      isExternal,
    } = transformHref(href);

    if (isInternal) {
      return (
        <Link
          to={transformedHref}
          className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {children}
        </Link>
      );
    }

    return (
      <a
        href={transformedHref}
        className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="mt-6 border-primary/20 border-l-2 pl-6 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul className="my-6 ml-6 list-disc [&>li]:mt-2">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-6 ml-6 list-decimal [&>li]:mt-2">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  hr: () => <hr className="my-8 border-border" />,
  table: ({ children }) => (
    <div className="my-6 w-full overflow-y-auto">
      <table className="w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="m-0 border-t p-0 even:bg-muted/50">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right">
      {children}
    </td>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg bg-muted p-4">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";

    // Handle Mermaid diagrams with lazy loading
    if (language === "mermaid") {
      return (
        <Suspense
          fallback={
            <div className="my-4 flex items-center justify-center rounded-lg bg-muted p-8 text-muted-foreground">
              Loading diagram...
            </div>
          }
        >
          <MermaidBlock chart={String(children).trim()} />
        </Suspense>
      );
    }

    // Inline code (no language specified and not in pre)
    if (!className) {
      return (
        <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm">
          {children}
        </code>
      );
    }

    // Code block (inside pre)
    return (
      <code className="font-mono text-sm leading-relaxed">{children}</code>
    );
  },
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ""}
      className="my-6 rounded-lg border border-border"
    />
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <article className="prose-slate">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
