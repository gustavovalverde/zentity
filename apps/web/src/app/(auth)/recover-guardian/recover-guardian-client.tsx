"use client";

import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/client";

type ApprovalState = "idle" | "approving" | "approved";

interface ApprovalResult {
  approvals: number;
  threshold: number;
  status: string;
}

export function RecoverGuardianClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<ApprovalState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApprovalResult | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const handleApprove = async () => {
    if (!token) {
      setError("Missing approval token.");
      return;
    }

    setError(null);
    setState("approving");

    try {
      const response = await trpc.recovery.approveGuardian.mutate({ token });
      setResult(response);
      setState("approved");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to approve recovery.";
      setError(message);
      setState("idle");
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          {state === "approved" ? (
            <Check className="size-6 text-emerald-600" />
          ) : (
            <ShieldCheck className="size-6 text-primary" />
          )}
        </div>
        <CardTitle>Approve Recovery</CardTitle>
        <CardDescription>
          Confirm you approve this account recovery request. Your approval does
          not grant account access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!token && (
          <div className="rounded-md border border-dashed px-3 py-2 text-muted-foreground text-sm">
            This approval link is missing its token. Ask the account owner for a
            new link.
          </div>
        )}

        {state === "approved" && result ? (
          <div className="space-y-2 text-center">
            <Badge variant="secondary">Approval recorded</Badge>
            <div className="text-muted-foreground text-sm">
              Approvals: {result.approvals}/{result.threshold}
            </div>
          </div>
        ) : (
          <Button
            className="w-full"
            disabled={!(hydrated && token) || state === "approving"}
            onClick={handleApprove}
          >
            {state === "approving" ? (
              <>
                <Spinner className="mr-2 size-4" />
                Recording approval...
              </>
            ) : (
              "Approve recovery"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
