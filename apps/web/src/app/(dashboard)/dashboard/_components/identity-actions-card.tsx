import { ArrowRight, FileCheck2, Link as LinkIcon, Shield } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface IdentityActionsCardProps {
  isVerified: boolean;
  web3Enabled: boolean;
}

/**
 * Identity Actions Card - Shows what users can do with their verified identity.
 * Displays available actions based on verification status and feature flags.
 */
export function IdentityActionsCard({
  isVerified,
  web3Enabled,
}: IdentityActionsCardProps) {
  if (!isVerified) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5 text-success" />
          What You Can Do
        </CardTitle>
        <CardDescription>
          Use your verified identity across different platforms
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={web3Enabled ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}
        >
          {/* Get Credentials */}
          <div className="flex flex-col justify-between rounded-lg border p-4">
            <div className="mb-3">
              <div className="mb-2 flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-info" />
                <span className="font-medium">Verifiable Credentials</span>
              </div>
              <p className="text-muted-foreground text-sm">
                Export your verified claims to any compatible wallet using
                OIDC4VCI.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/dashboard/credentials">
                Get Credentials
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* On-Chain Attestation */}
          {web3Enabled && (
            <div className="flex flex-col justify-between rounded-lg border p-4">
              <div className="mb-3">
                <div className="mb-2 flex items-center gap-2">
                  <LinkIcon className="h-5 w-5 text-info" />
                  <span className="font-medium">On-Chain Attestation</span>
                  <Badge variant="secondary">Web3</Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  Register your identity on-chain for DeFi and Web3 access with
                  encrypted data.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link href="/dashboard/attestation">
                  Go On-Chain
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
