import { cn } from "@/lib/utils/utils";

function Skeleton({
  className,
  ...props
}: Readonly<React.ComponentProps<"div">>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-accent", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
