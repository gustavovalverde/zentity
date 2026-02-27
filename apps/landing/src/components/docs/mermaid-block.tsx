import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";

interface MermaidBlockProps {
  chart: string;
}

// Initialize mermaid — theming is handled via CSS class overrides on the
// container rather than themeVariables, because Mermaid's color parser (khroma)
// cannot resolve CSS custom properties like `hsl(var(--muted))`.
mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
  fontFamily: "inherit",
  flowchart: {
    padding: 20,
    nodeSpacing: 50,
    rankSpacing: 50,
  },
  mindmap: {
    padding: 20,
    maxNodeWidth: 250,
  },
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

  // Force mindmap and flowchart nodes to use theme semantic colors for perfect contrast
  const containerClasses = [
    "my-6 flex justify-center overflow-x-auto rounded-lg border border-border bg-card p-6 shadow-sm",
    // General SVG fixes
    "[&_foreignObject]:overflow-visible [&>svg]:h-auto [&>svg]:max-w-full [&>svg]:overflow-visible",

    // Mindmap node background and border
    "[&_.mindmap-node_rect]:!fill-muted [&_.mindmap-node_rect]:!stroke-border",
    "[&_.mindmap-node_path]:!fill-muted [&_.mindmap-node_path]:!stroke-border",
    "[&_.mindmap-node_circle]:!fill-muted [&_.mindmap-node_circle]:!stroke-border",
    "[&_.mindmap-node_polygon]:!fill-muted [&_.mindmap-node_polygon]:!stroke-border",
    // Mindmap text and icons
    "[&_.mindmap-node_text]:!fill-foreground [&_.mindmap-node_span]:!text-foreground",
    "[&_.mindmap-node_.node-icon]:!text-foreground",
    // Mindmap connection lines
    "[&_path.edge]:!stroke-border",

    // Flowchart default node background and border (avoid overriding explicit .data or .persistent custom classes if possible, though !important overrides them. Since we updated the markdown to use hsl vars, we just target .default)
    "[&_.node.default_rect]:!fill-muted [&_.node.default_rect]:!stroke-border",
    "[&_.node.default_circle]:!fill-muted [&_.node.default_circle]:!stroke-border",
    "[&_.node.default_polygon]:!fill-muted [&_.node.default_polygon]:!stroke-border",
    "[&_.node.default_path]:!fill-muted [&_.node.default_path]:!stroke-border",
    // Flowchart text
    "[&_.node_text]:!fill-foreground [&_.node_span]:!text-foreground",
    "[&_.node_.label]:!text-foreground",
    // Flowchart connection lines & arrows
    "[&_.edgePath_.path]:!stroke-border",
    "[&_.marker]:!fill-border [&_.marker]:!stroke-border",
    // Flowchart cluster background (subgraphs)
    "[&_.cluster_rect]:!fill-muted/30 [&_.cluster_rect]:!stroke-border",
    "[&_.cluster-label_text]:!fill-foreground [&_.cluster-label_span]:!text-foreground",
    // Flowchart edge labels
    "[&_.edgeLabel]:!bg-card [&_.edgeLabel_p]:!bg-card [&_.edgeLabel_rect]:!fill-card",
  ].join(" ");

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
