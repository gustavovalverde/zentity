import { ArrowRight, Link as LinkIcon } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { ProfileGreetingName } from "@/components/dashboard/profile-greeting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth/auth";
import { isWeb3Enabled } from "@/lib/feature-flags";

import {
  PrivacyInfoSection,
  VerificationStatusCard,
} from "./_components/verification-status-card";
import { VerificationStatusSkeleton } from "./_components/verification-status-skeleton";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id;
  const web3Enabled = isWeb3Enabled();

  return (
    <div className="space-y-6">
      {/* INSTANT - Welcome Header */}
      <div>
        <h1 className="font-bold text-2xl">
          Welcome back, <ProfileGreetingName />
        </h1>
        <p className="text-muted-foreground text-sm">
          Your privacy-preserving identity at a glance
        </p>
      </div>

      {/* Main Action Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* STREAMING - Verification Status Card */}
        <Suspense fallback={<VerificationStatusSkeleton />}>
          <VerificationStatusCard userId={userId} />
        </Suspense>

        {/* INSTANT - Blockchain Card (always enabled, attestation page handles access) */}
        {web3Enabled ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <LinkIcon className="h-4 w-4" />
                  On-Chain Attestation
                </CardTitle>
                <Badge variant="secondary">Web3</Badge>
              </div>
              <CardDescription>
                Attest your identity on-chain for DeFi access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href="/dashboard/attestation">
                  Manage Attestation
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/* INSTANT - Quick Actions Card */}
        <Card className={web3Enabled ? "md:col-span-2" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Button asChild size="sm" variant="ghost">
                <Link href="/dashboard/settings">Manage Passkeys</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/dashboard/verification">View Proofs</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/dashboard/dev">Debug Tools</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* STREAMING - Privacy Info */}
      <Suspense fallback={null}>
        <PrivacyInfoSection userId={userId} />
      </Suspense>
    </div>
  );
}
