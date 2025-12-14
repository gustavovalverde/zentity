"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  variant?: "full" | "icon";
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function Logo({ variant = "full", className, size = "md" }: LogoProps) {
  const isFull = variant === "full";

  // Logo image is 400x218 (ratio 1.83:1)
  // Icon is square (1:1)
  const sizes = {
    sm: { full: { width: 66, height: 36 }, icon: { width: 24, height: 24 } },
    md: { full: { width: 73, height: 40 }, icon: { width: 32, height: 32 } },
    lg: { full: { width: 110, height: 60 }, icon: { width: 40, height: 40 } },
  };

  const dimensions = sizes[size][isFull ? "full" : "icon"];

  const src = isFull
    ? "/images/logo/logo-full-400w.png"
    : "/images/logo/icon-512.png";

  return (
    <Image
      src={src}
      alt="Zentity"
      width={dimensions.width}
      height={dimensions.height}
      className={cn("dark:invert object-contain", className)}
      priority
    />
  );
}
