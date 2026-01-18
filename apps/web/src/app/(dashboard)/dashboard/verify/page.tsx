import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Scan,
  User,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TierBadge } from "@/components/assurance/tier-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getTierProfile } from "@/lib/assurance/data";
import { getTierProgress } from "@/lib/assurance/tier";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";
import { cn } from "@/lib/utils/classname";

import { FheStatusPoller } from "./_components/fhe-status-poller";

/**
 * Dashboard Verification Page
 *
 * Shows verification progress and routes to the appropriate step.
 * Users can complete identity verification incrementally from the dashboard.
 *
 * Verification steps:
 * 1. Document upload and OCR
 * 2. Liveness check + Face matching
 * 3. ZK proof generation (automatic)
 */
export default async function VerifyPage() {
  const session = await getCachedSession(await headers());
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }

  const [tierProfile, bundle] = await Promise.all([
    getTierProfile(userId, session),
    getIdentityBundleByUserId(userId),
  ]);

  // Already at max tier
  if (tierProfile.tier >= 3) {
    redirect("/dashboard");
  }

  const hasFheKeys = !!bundle?.fheKeyId;
  const progress = getTierProgress(tierProfile);
  const { assurance } = tierProfile;

  const steps = [
    {
      id: "document",
      title: "Verify Document",
      description: "Upload and verify your identity document",
      icon: FileText,
      completed: assurance.identity.documentVerified,
      href: "/dashboard/verify/document",
    },
    {
      id: "liveness",
      title: "Liveness Check",
      description: "Complete a liveness verification",
      icon: Scan,
      completed: assurance.identity.livenessPassed,
      href: "/dashboard/verify/liveness",
    },
    {
      id: "face-match",
      title: "Face Match",
      description: "Match your face to your document photo",
      icon: User,
      completed: assurance.identity.faceMatchPassed,
      href: "/dashboard/verify/liveness",
    },
  ];

  const completedSteps = steps.filter((s) => s.completed).length;
  const nextStep = steps.find((s) => !s.completed);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl">Complete Verification</h1>
          <p className="text-muted-foreground">
            Verify your identity to unlock more features
          </p>
        </div>
        <TierBadge
          label={tierProfile.label}
          size="md"
          tier={tierProfile.tier}
        />
      </div>

      {/* FHE Keys Warning */}
      {!hasFheKeys && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Account Setup Required</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              You need to complete account setup before verifying your identity.
              This includes securing your encryption keys which are required for
              privacy-preserving verification.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/sign-up">Complete Account Setup</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Progress Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Verification Progress</span>
            <span className="font-normal text-muted-foreground text-sm">
              {completedSteps} of {steps.length} complete
            </span>
          </CardTitle>
          <CardDescription>
            Complete all steps to reach Tier 3 and unlock on-chain attestation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Progress className="h-2" value={progress} />

          {/* Steps List */}
          <ul className="space-y-3">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isNext = nextStep?.id === step.id;

              function getStepBadgeClass() {
                if (step.completed) {
                  return "bg-success text-success-foreground";
                }
                if (isNext) {
                  return "bg-primary text-primary-foreground";
                }
                return "bg-muted text-muted-foreground";
              }

              return (
                <li
                  className={cn(
                    "flex items-start gap-4 rounded-lg border p-4 transition-colors",
                    step.completed && "border-success/30 bg-success/5",
                    isNext && "border-primary/50 bg-primary/5"
                  )}
                  key={step.id}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      getStepBadgeClass()
                    )}
                  >
                    {step.completed ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <span className="font-medium">{index + 1}</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span
                        className={cn(
                          "font-medium",
                          step.completed && "text-success"
                        )}
                      >
                        {step.title}
                      </span>
                      {step.completed && (
                        <span className="text-success text-xs">Complete</span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {step.description}
                    </p>
                  </div>

                  {isNext && hasFheKeys && (
                    <Button asChild size="sm">
                      <Link href={step.href}>Start</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* CTA */}
          {nextStep && hasFheKeys && (
            <Button asChild className="w-full">
              <Link href={nextStep.href}>Continue with {nextStep.title}</Link>
            </Button>
          )}

          {!nextStep &&
            tierProfile.tier === 2 &&
            assurance.proof.zkProofsComplete &&
            !assurance.proof.fheComplete && (
              <div className="space-y-3">
                <FheStatusPoller />
                <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 p-3 text-blue-700 dark:text-blue-400">
                  <Scan className="h-5 w-5 animate-pulse" />
                  <span className="text-sm">
                    Verification complete! Finalizing encryption...
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  Your ZK proofs have been generated. FHE encryption is being
                  finalized in the background. This page will update
                  automatically.
                </p>
              </div>
            )}

          {!nextStep &&
            tierProfile.tier === 2 &&
            !assurance.proof.zkProofsComplete && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="text-sm">
                    Identity verified, but ZK proofs were not generated.
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  To reach Tier 3, you need to complete verification again. ZK
                  proofs are generated during the verification process and
                  require your document data, which is not stored for privacy
                  reasons.
                </p>
                <Button asChild className="w-full">
                  <Link href="/dashboard/verify/document">
                    Start New Verification
                  </Link>
                </Button>
              </div>
            )}
        </CardContent>
      </Card>

      {/* Privacy Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2 text-muted-foreground text-sm">
            <p>
              <strong className="text-foreground">
                Privacy-first verification:
              </strong>{" "}
              Your document data is processed securely and never stored in
              plaintext.
            </p>
            <p>
              Only cryptographic commitments, signed claims, and zero-knowledge
              proofs are persisted. Your raw images are deleted immediately
              after processing.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
