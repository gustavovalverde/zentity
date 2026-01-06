import type { ComponentType } from "react";

import { colorStyles, type SemanticColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: { container: "p-1.5 rounded-md", icon: "size-4" },
  md: { container: "p-2 rounded-lg", icon: "size-5" },
  lg: { container: "p-2.5 rounded-xl", icon: "size-6" },
  xl: { container: "p-3 rounded-xl", icon: "size-8" },
};

interface ColoredIconBoxProps {
  icon: ComponentType<{ className?: string }>;
  color: SemanticColor;
  size?: keyof typeof sizeClasses;
  className?: string;
}

export function ColoredIconBox({
  icon: Icon,
  color,
  size = "md",
  className,
}: ColoredIconBoxProps) {
  const styles = colorStyles[color];
  const sizes = sizeClasses[size];

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border transition-colors",
        sizes.container,
        styles.bg,
        styles.border,
        className,
      )}
    >
      <Icon className={cn(sizes.icon, styles.iconText)} />
    </div>
  );
}
