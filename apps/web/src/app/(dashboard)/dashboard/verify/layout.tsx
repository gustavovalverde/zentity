import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Dashboard Verification Layout
 *
 * Provides consistent header and navigation for the verification flow.
 * Each step (document, liveness) is rendered as a child page.
 */
export default function VerifyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild size="sm" variant="ghost">
        <Link href="/dashboard">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Link>
      </Button>
      {children}
    </div>
  );
}
