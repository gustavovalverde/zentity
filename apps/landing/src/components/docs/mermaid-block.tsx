import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";

interface MermaidBlockProps {
  chart: string;
}

// Initialize mermaid with dark mode support
mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
  fontFamily: "inherit",
});

export default function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const renderChart = async () => {
      if (!containerRef.current) return;

      try {
        // Generate a unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;

        const { svg: renderedSvg } = await mermaid.render(id, chart);
        setSvg(renderedSvg);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
      }
    };

    void renderChart();
  }, [chart]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
        <p className="font-medium">Diagram Error</p>
        <p className="mt-1 text-xs">{error}</p>
        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-muted-foreground text-xs">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-6 flex justify-center overflow-x-auto rounded-lg bg-muted/50 p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
