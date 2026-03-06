"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CLAIM_LABELS } from "@/data/veripass";
import type { useVpFlow } from "@/hooks/use-vp-flow";
import { isDcApiAvailable, requestPresentation } from "@/lib/dc-api";

interface VpRequestProps {
  flow: ReturnType<typeof useVpFlow>;
  scenarioName: string;
}

export function VpRequest({ flow, scenarioName }: VpRequestProps) {
  if (flow.state === "idle") {
    return null;
  }

  if (flow.state === "creating") {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <div className="animate-pulse text-muted-foreground text-sm">
            Creating verification session...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (flow.state === "pending" && flow.authorizationUri) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="text-center">
            <h3 className="mb-1 font-semibold text-sm">
              Present your credential
            </h3>
            <p className="text-muted-foreground text-xs">
              Scan the QR code with your wallet or use the link below
            </p>
          </div>

          {/* QR Code placeholder — encoded authorization URI */}
          <div className="mx-auto flex size-48 items-center justify-center rounded-lg border-2 border-muted-foreground/20 border-dashed bg-muted/50">
            <div className="space-y-1 text-center">
              <div className="font-mono text-muted-foreground text-xs">
                QR Code
              </div>
              <div className="text-[10px] text-muted-foreground/60">
                Install qrcode.react for rendering
              </div>
            </div>
          </div>

          {/* Deep link */}
          <div className="flex flex-col gap-2">
            <a
              className="block break-all rounded-lg border p-2 text-center font-mono text-primary text-xs hover:bg-muted/50"
              href={flow.authorizationUri}
            >
              Open in Wallet
            </a>

            {/* DC API button (experimental) */}
            {isDcApiAvailable() && flow.sessionId && (
              <Button
                onClick={async () => {
                  try {
                    const res = await fetch(
                      `/api/oid4vp/request?session_id=${flow.sessionId}`
                    );
                    if (!res.ok) {
                      return;
                    }
                    const signedRequest = await res.text();
                    await requestPresentation(signedRequest);
                  } catch {
                    // DC API not supported or user cancelled
                  }
                }}
                size="sm"
                variant="outline"
              >
                Verify with Browser
                <Badge className="ml-2 text-[10px]" variant="secondary">
                  Experimental
                </Badge>
              </Button>
            )}
          </div>

          <div className="text-center text-muted-foreground text-xs">
            Waiting for response...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (flow.state === "verified" && flow.result) {
    const claims = flow.result;
    const claimEntries = Object.entries(claims);

    return (
      <Card className="border-green-500/30 bg-green-500/5">
        <CardContent className="space-y-4 p-6">
          <div className="text-center">
            <h3 className="font-bold text-lg">Verification Successful</h3>
            <p className="text-muted-foreground text-sm">
              {scenarioName} received {claimEntries.length} claims
            </p>
          </div>

          <div className="space-y-1">
            {claimEntries.map(([key, value]) => (
              <div
                className="flex items-center justify-between rounded-lg border p-3"
                key={key}
              >
                <span className="font-medium text-sm">
                  {CLAIM_LABELS[key] || key.replace(/_/g, " ")}
                </span>
                <Badge className="font-mono text-xs" variant="secondary">
                  {formatValue(value)}
                </Badge>
              </div>
            ))}
          </div>

          <Button className="w-full" onClick={flow.reset}>
            Done
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (flow.state === "failed" || flow.state === "expired") {
    return (
      <Card className="border-destructive/30">
        <CardContent className="space-y-3 p-6 text-center">
          <h3 className="font-semibold">
            {flow.state === "expired"
              ? "Session Expired"
              : "Verification Failed"}
          </h3>
          <p className="text-muted-foreground text-sm">
            {flow.state === "expired"
              ? "The verification session has timed out."
              : "Something went wrong. Please try again."}
          </p>
          <Button onClick={flow.reset} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function formatValue(value: unknown): string {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}
