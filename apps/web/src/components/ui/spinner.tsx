import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils/classname";

const sizeClasses = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
  xl: "size-8",
} as const;

type SpinnerSize = keyof typeof sizeClasses;

interface SpinnerProps extends Omit<React.ComponentProps<"svg">, "size"> {
  size?: SpinnerSize;
}

function Spinner({ className, size = "sm", ...props }: Readonly<SpinnerProps>) {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn(sizeClasses[size], "animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
export type { SpinnerProps, SpinnerSize };
