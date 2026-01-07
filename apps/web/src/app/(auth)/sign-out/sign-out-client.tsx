"use client";

import { useEffect } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { completeSignOut } from "@/lib/auth/session-manager";

interface SignOutClientProps {
  redirectTo: string;
}

export function SignOutClient({ redirectTo }: SignOutClientProps) {
  useEffect(() => {
    completeSignOut({ redirectTo }).catch(() => {
      // If sign-out fails, still redirect to avoid trapping the user
      window.location.assign(redirectTo);
    });
  }, [redirectTo]);

  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
