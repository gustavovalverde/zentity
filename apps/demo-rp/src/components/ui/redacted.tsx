"use client";

import { usePrivacyMode } from "@/components/providers/privacy-mode-provider";
import { cn } from "@/lib/utils";

interface RedactedProps {
  children: React.ReactNode;
  className?: string;
  length?: number;
}

const MASK_CHAR = "\u2022";

export function Redacted({
  children,
  length,
  className,
}: Readonly<RedactedProps>) {
  const { privacyMode } = usePrivacyMode();

  if (!privacyMode) {
    return <>{children}</>;
  }

  const maskLength = length ?? inferLength(children) ?? 8;
  const mask = MASK_CHAR.repeat(maskLength);

  return (
    <span
      aria-hidden="true"
      className={cn("select-none text-muted-foreground", className)}
      data-slot="redacted"
    >
      {mask}
    </span>
  );
}

function inferLength(node: React.ReactNode): number | undefined {
  if (typeof node === "string") {
    return Math.min(node.length, 20);
  }
  if (typeof node === "number") {
    return String(node).length;
  }
  return undefined;
}
