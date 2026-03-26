import { useEffect, useRef } from "react";

import { JsonBlock } from "@/components/x402/json-block";
import type { TraceEntry } from "@/data/x402";

function statusColor(status: number): string {
  if (status >= 200 && status < 300) {
    return "text-emerald-700";
  }
  if (status === 402) {
    return "text-amber-700";
  }
  if (status >= 400) {
    return "text-red-600";
  }
  return "text-muted-foreground";
}

function TraceItem({ item }: { item: TraceEntry }) {
  if (item.type === "action") {
    return (
      <div className="fade-in slide-in-from-bottom-2 animate-in border-primary/40 border-l-2 py-2 pl-4 duration-300">
        <div className="flex items-center gap-2">
          <div className="size-1.5 animate-pulse rounded-full bg-primary" />
          <span className="font-medium font-mono text-amber-700 text-xs">
            {item.label}
          </span>
        </div>
        {item.detail && (
          <p className="mt-1 pl-3.5 text-[10px] text-muted-foreground">
            {item.detail}
          </p>
        )}
      </div>
    );
  }

  if (item.type === "request") {
    return (
      <div className="fade-in slide-in-from-bottom-2 animate-in space-y-1.5 py-2 duration-300">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="rounded bg-secondary px-1.5 py-0.5 font-bold text-[10px] text-secondary-foreground">
            {item.method}
          </span>
          <span className="text-foreground">{item.url}</span>
        </div>
        {item.headers && (
          <div className="space-y-0.5 pl-2">
            {Object.entries(item.headers).map(([k, v]) => (
              <div className="font-mono text-[10px]" key={k}>
                <span className="font-medium text-muted-foreground">{k}: </span>
                <span className="text-foreground">{v}</span>
              </div>
            ))}
          </div>
        )}
        {item.body != null && <JsonBlock data={item.body} />}
      </div>
    );
  }

  // Response
  return (
    <div className="fade-in slide-in-from-bottom-2 animate-in space-y-1.5 py-2 duration-300">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="text-muted-foreground">←</span>
        <span className={`font-bold ${statusColor(item.status ?? 0)}`}>
          {item.status} {item.statusText}
        </span>
      </div>
      {item.body != null && <JsonBlock data={item.body} />}
    </div>
  );
}

export function ProtocolTrace({ traces }: { traces: TraceEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const traceCount = traces.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new entries
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    }
  }, [traceCount]);

  if (traces.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-center text-muted-foreground text-sm">
          Select a resource to start the x402 protocol flow
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-4" ref={scrollRef}>
      <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
        Protocol Trace
      </h3>
      {traces.map((t) => (
        <TraceItem item={t} key={t.id} />
      ))}
    </div>
  );
}
