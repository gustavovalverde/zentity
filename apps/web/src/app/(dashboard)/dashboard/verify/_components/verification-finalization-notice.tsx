import { CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils/classname";

interface VerificationFinalizationNoticeProps {
  className?: string;
  description?: string;
  title?: string;
}

const DEFAULT_DESCRIPTION =
  "Your checks are complete. We're finishing setup in the background.";

export function VerificationFinalizationNotice({
  className,
  title = "Finalizing Verification",
  description = DEFAULT_DESCRIPTION,
}: Readonly<VerificationFinalizationNoticeProps>) {
  return (
    <Alert className={cn(className)} variant="info">
      <CheckCircle2 className="h-4 w-4 animate-pulse" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
