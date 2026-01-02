import type * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/utils";

const spinnerVariants = cva("animate-spin text-current", {
  variants: {
    size: {
      sm: "size-4",
      md: "size-5",
      lg: "size-7",
      xl: "size-9",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

function Spinner({
  className,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof spinnerVariants>) {
  return (
    <span
      aria-live="polite"
      className={cn("inline-flex items-center justify-center", className)}
      role="status"
      {...props}
    >
      <Loader2 aria-hidden="true" className={cn(spinnerVariants({ size }))} />
    </span>
  );
}

export { Spinner };
