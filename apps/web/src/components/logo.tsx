import Image from "next/image";

import { cn } from "@/lib/utils/utils";

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

  // Use SVG for perfect scaling at any size
  const src = isFull ? "/images/logo/logo.svg" : "/images/logo/icon.svg";

  return (
    <Image
      alt="Zentity"
      className={cn("object-contain dark:invert", className)}
      height={dimensions.height}
      priority
      src={src}
      unoptimized
      width={dimensions.width} // SVGs don't need Next.js optimization
    />
  );
}
