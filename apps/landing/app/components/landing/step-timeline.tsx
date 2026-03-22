import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";

type StepTimelineStep = {
  title: string;
  detail: string;
};

type StepTimelineProps = {
  readonly label: string;
  readonly steps: readonly StepTimelineStep[];
  readonly className?: string;
};

export function StepTimeline({ label, steps, className }: StepTimelineProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-background",
        className,
      )}
    >
      <div className="flex h-9 items-center gap-1.5 border-border border-b bg-muted/30 px-3">
        <div className="size-2.5 rounded-full bg-red-500/80" />
        <div className="size-2.5 rounded-full bg-yellow-500/80" />
        <div className="size-2.5 rounded-full bg-green-500/80" />
        <div className="ml-2 font-mono text-[11px] text-muted-foreground">
          {label}
        </div>
      </div>

      <ItemGroup className="relative p-4">
        <div className="absolute top-8 bottom-8 left-[31.5px] w-px bg-border" />
        {steps.map((step, index) => (
          <div key={step.title} className="relative flex items-start gap-3">
            <Badge
              variant="outline"
              className="z-10 flex size-8 items-center justify-center rounded-full bg-card p-0 text-sm text-foreground"
            >
              {index + 1}
            </Badge>
            <Item variant="outline" className="flex-1">
              <ItemContent>
                <ItemTitle>{step.title}</ItemTitle>
                <ItemDescription>{step.detail}</ItemDescription>
              </ItemContent>
            </Item>
          </div>
        ))}
      </ItemGroup>
    </div>
  );
}
