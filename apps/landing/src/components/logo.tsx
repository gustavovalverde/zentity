import { cn } from "@/lib/utils";

interface LogoProps {
  variant?: "full" | "icon";
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function Logo({ variant = "full", className, size = "md" }: LogoProps) {
  const isFull = variant === "full";

  // Logo SVG aspect ratio ~1.83:1, Icon is square (1:1)
  const sizes = {
    sm: { full: { width: 66, height: 36 }, icon: { width: 24, height: 24 } },
    md: { full: { width: 73, height: 40 }, icon: { width: 32, height: 32 } },
    lg: { full: { width: 110, height: 60 }, icon: { width: 40, height: 40 } },
  };

  const dimensions = sizes[size][isFull ? "full" : "icon"];
  const src = isFull ? "/images/logo/logo.svg" : "/images/logo/icon.svg";

  return (
    <img
      src={src}
      alt="Zentity"
      width={dimensions.width}
      height={dimensions.height}
      className={cn("object-contain dark:invert", className)}
    />
  );
}
