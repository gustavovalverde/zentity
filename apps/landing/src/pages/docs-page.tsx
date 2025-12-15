import { Navigate, useParams } from "react-router-dom";
import { MarkdownRenderer } from "@/components/docs/markdown-renderer";
import { getAllDocSlugs, getDocBySlug } from "@/content/docs";
import { useDocumentHead } from "@/lib/use-document-head";

export function DocsPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = slug ? getDocBySlug(slug) : undefined;

  // Update document head with doc-specific title and description
  useDocumentHead({
    title: doc ? `${doc.title} | Zentity Docs` : "Zentity Docs",
    description: doc?.description,
  });

  // Redirect to first doc if no slug
  if (!slug) {
    return <Navigate to="/docs/architecture" replace />;
  }

  // Show 404-like state for unknown docs
  if (!doc) {
    const availableSlugs = getAllDocSlugs();
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="text-2xl font-bold">Document Not Found</h1>
        <p className="mt-2 text-muted-foreground">
          The document "{slug}" doesn't exist.
        </p>
        <div className="mt-6">
          <p className="text-sm text-muted-foreground mb-2">
            Available documents:
          </p>
          <ul className="text-sm">
            {availableSlugs.map((s) => (
              <li key={s}>
                <a
                  href={`/docs/${s}`}
                  className="text-primary underline underline-offset-4"
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return <MarkdownRenderer content={doc.content} />;
}
