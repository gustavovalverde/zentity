import { cn } from "@/lib/utils";

type SectionHeaderAlignment = "center" | "left";
type SectionHeaderWidth = "sm" | "md" | "lg";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  align?: SectionHeaderAlignment;
  maxWidth?: SectionHeaderWidth;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
};

const subtitleWidthClasses: Record<SectionHeaderWidth, string> = {
  sm: "max-w-xl",
  md: "max-w-2xl",
  lg: "max-w-3xl",
};

export function SectionHeader({
  title,
  subtitle,
  align = "center",
  maxWidth = "md",
  className,
  titleClassName,
  subtitleClassName,
}: SectionHeaderProps) {
  const isCenter = align === "center";

  return (
    <div
      className={cn(
        "landing-section-header",
        isCenter ? "text-center" : "text-left",
        className,
      )}
    >
      <h2 className={cn("landing-section-title", titleClassName)}>{title}</h2>
      {subtitle ? (
        <p
          className={cn(
            "landing-section-subtitle",
            subtitleWidthClasses[maxWidth],
            isCenter && "mx-auto",
            subtitleClassName,
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
