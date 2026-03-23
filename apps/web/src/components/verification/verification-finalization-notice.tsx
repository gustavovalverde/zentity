import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils/classname";

interface VerificationFinalizationNoticeProps {
  className?: string;
  description?: string;
  title?: string;
}

const DEFAULT_DESCRIPTION =
  "Your privacy proofs are ready. We're encrypting the remaining verification data in the background.";

export function VerificationFinalizationNotice({
  className,
  title = "Finalizing Verification",
  description = DEFAULT_DESCRIPTION,
}: Readonly<VerificationFinalizationNoticeProps>) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg border border-info/30 bg-info/5 p-4",
        className
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-info/10 text-info">
        <CheckCircle2 className="h-5 w-5 animate-pulse" />
      </div>
      <div className="flex-1">
        <p className="font-medium text-info">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}
