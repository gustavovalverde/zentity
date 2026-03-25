import type * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/classname";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border border-l-[3px] px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "border-l-destructive bg-card text-card-foreground *:data-[slot=alert-title]:text-destructive [&>svg]:text-destructive",
        success:
          "border-l-success bg-card text-card-foreground [&>svg]:text-success",
        warning:
          "border-l-warning bg-card text-card-foreground [&>svg]:text-warning",
        info: "border-l-info bg-card text-card-foreground [&>svg]:text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Alert({
  className,
  variant,
  ...props
}: Readonly<React.ComponentProps<"div"> & VariantProps<typeof alertVariants>>) {
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    />
  );
}

function AlertTitle({
  className,
  ...props
}: Readonly<React.ComponentProps<"div">>) {
  return (
    <div
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className
      )}
      data-slot="alert-title"
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: Readonly<React.ComponentProps<"div">>) {
  return (
    <div
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-muted-foreground text-sm [&_p]:leading-relaxed",
        className
      )}
      data-slot="alert-description"
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
