import { Fragment, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface BreachEntry {
  year: number;
  content: ReactNode;
}

/** Convert `**bold**` segments in plain text to `<strong>` elements. */
function inlineBold(text: string): ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={part}>{part}</strong> : part,
  );
}

/**
 * Parse the markdown between `<!-- BREACH_TIMELINE -->` markers into
 * structured entries. Expected format per line:
 *   - **2024** — National Public Data, 2.9 billion records...
 *
 * The last non-bullet paragraph (starting with `**And it has not stopped**`)
 * is returned separately as the closing text.
 */
function parseTimeline(md: string): {
  entries: BreachEntry[];
  closing: ReactNode;
} {
  const lines = md.trim().split(/\n/);
  const entries: BreachEntry[] = [];
  const closingLines: string[] = [];
  let pastBullets = false;

  for (const line of lines) {
    const bulletMatch = /^-\s+\*\*(\d{4})\*\*\s*[—–-]\s*(.*)/.exec(line);
    if (bulletMatch && !pastBullets) {
      entries.push({
        year: Number.parseInt(bulletMatch[1], 10),
        content: inlineBold(bulletMatch[2]),
      });
    } else if (entries.length > 0 && line.trim() !== "") {
      pastBullets = true;
      closingLines.push(line);
    }
  }

  return { entries, closing: inlineBold(closingLines.join(" ")) };
}

export function BreachTimeline({
  markdown,
  className,
}: {
  readonly markdown: string;
  readonly className?: string;
}) {
  const { entries, closing } = parseTimeline(markdown);

  return (
    <div
      className={cn("rounded-lg border border-border bg-background", className)}
    >
      <div className="grid grid-cols-[auto_1fr] gap-x-3 p-4 sm:p-6">
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1;
          return (
            <Fragment key={entry.year}>
              <div className="flex flex-col items-center">
                <Badge
                  variant="outline"
                  className="z-10 shrink-0 rounded-full bg-card font-mono text-xs"
                >
                  {entry.year}
                </Badge>
                <div
                  className={cn("mt-1.5 w-px flex-1", !isLast && "bg-border")}
                  style={
                    isLast
                      ? {
                          backgroundImage:
                            "repeating-linear-gradient(to bottom, var(--color-border) 0 3px, transparent 3px 7px)",
                        }
                      : undefined
                  }
                />
              </div>
              <div className="pb-4">
                <p className="landing-body">{entry.content}</p>
              </div>
            </Fragment>
          );
        })}

        {/* Continuation indicator */}
        <div className="flex justify-center">
          <div className="mt-1.5 size-1.5 rounded-full bg-muted-foreground/40" />
        </div>
        <p className="landing-body">{closing}</p>
      </div>
    </div>
  );
}
