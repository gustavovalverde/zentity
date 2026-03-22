import { marked } from "marked";
import { useMemo } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const html = useMemo(
    () => marked.parse(content, { async: false }) as string,
    [content],
  );

  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
