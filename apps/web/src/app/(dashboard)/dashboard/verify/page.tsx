import { eq } from "drizzle-orm";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getAssuranceState } from "@/lib/assurance/data";
import { getTierProgress } from "@/lib/assurance/features";
import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import {
  getPrimaryWalletAddress,
  userHasPassword,
} from "@/lib/db/queries/auth";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";
import { passkeys } from "@/lib/db/schema/auth";
import { cn } from "@/lib/utils/classname";

import { FheErrorBanner } from "./_components/fhe-error-banner";
import { FheStatusPoller } from "./_components/fhe-status-poller";
import { VerifyCta } from "./_components/verify-cta";

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
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }
  const cookies = headersObj.get("cookie");

  const [assuranceState, bundle, hasPassword, passkeyRow, wallet] =
    await Promise.all([
      getAssuranceState(userId, session),
      getIdentityBundleByUserId(userId),
      userHasPassword(userId),
      db
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(eq(passkeys.userId, userId))
        .limit(1)
        .get(),
      getPrimaryWalletAddress(userId),
    ]);

  // Already at max tier (Tier 2 = Verified)
  if (assuranceState.tier >= 2) {
    redirect("/dashboard");
  }

  const hasEnrollment = Boolean(bundle?.fheKeyId);
  const hasFheError = bundle?.fheStatus === "error";
  const progress = getTierProgress(assuranceState);
  const { details } = assuranceState;

  const steps = [
    {
      id: "document",
      title: "Scan ID",
      description: "Upload a government-issued ID document",
      icon: FileText,
      completed: details.documentVerified,
      href: "/dashboard/verify/document",
    },
    {
      id: "liveness",
      title: "Take Selfie",
      description: "Quick liveness check to confirm you're a real person",
      icon: Scan,
      completed: details.livenessVerified,
      href: "/dashboard/verify/liveness",
    },
    {
      id: "face-match",
      title: "Face Match",
      description: "Match your selfie to your document photo",
      icon: User,
      completed: details.faceMatchVerified,
      href: "/dashboard/verify/liveness",
    },
  ];

  const completedSteps = steps.filter((s) => s.completed).length;
  const nextStep = steps.find((s) => !s.completed);
  const identityComplete =
    details.documentVerified &&
    details.livenessVerified &&
    details.faceMatchVerified;

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
        <TierBadge size="md" tier={assuranceState.tier} />
      </div>

      {hasFheError && bundle?.fheKeyId && (
        <FheErrorBanner fheKeyId={bundle.fheKeyId} />
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
            Complete all steps to reach Verified tier and unlock on-chain
            attestation
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

                  {isNext && hasEnrollment && (
                    <Button asChild size="sm">
                      <Link href={step.href}>Start</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* CTA */}
          {nextStep && (
            <VerifyCta
              cookies={cookies}
              hasEnrollment={hasEnrollment}
              hasPasskeys={Boolean(passkeyRow)}
              hasPassword={hasPassword}
              nextStepHref={nextStep.href}
              nextStepTitle={nextStep.title}
              wallet={wallet}
              walletScopeId={userId}
            />
          )}

          {/* Identity complete but proofs pending - show FHE status */}
          {!nextStep &&
            identityComplete &&
            details.zkProofsComplete &&
            !details.fheComplete && (
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

          {/* Identity complete but proofs missing - need re-verification */}
          {!nextStep && identityComplete && !details.zkProofsComplete && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-sm">
                  Identity verified, but ZK proofs were not generated.
                </span>
              </div>
              <p className="text-muted-foreground text-sm">
                To reach Verified tier, you need to complete verification again.
                ZK proofs are generated during the verification process and
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
