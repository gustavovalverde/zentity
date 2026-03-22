"use client";

import { useEffect, useId, useRef, useState } from "react";

const cache = new Map<string, string>();

function getCacheKey(chart: string, theme: string): string {
  return `${theme}:${chart}`;
}

function useResolvedTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const update = () => {
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const theme = useResolvedTheme();

  useEffect(() => {
    const key = getCacheKey(chart, theme);
    const cached = cache.get(key);
    if (cached) {
      setSvg(cached);
      return;
    }

    let cancelled = false;
    import("mermaid").then(async (mod) => {
      if (cancelled) return;
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        fontFamily: "inherit",
        theme: theme === "dark" ? "dark" : "default",
      });
      const { svg: rendered } = await mermaid.render(
        `mermaid-${id.replace(/:/g, "")}`,
        chart,
      );
      if (cancelled) return;
      cache.set(key, rendered);
      setSvg(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [chart, theme, id]);

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-muted/30 p-8 text-muted-foreground text-sm">
        Loading diagram...
      </div>
    );
  }

  // SVG from mermaid.render() — content is from local markdown, not user input
  return (
    <div
      ref={containerRef}
      className="my-4 overflow-x-auto [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
