import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Scan,
  ShieldCheck,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TierBadge } from "@/components/assurance/tier-badge";
import { FheStatusPoller } from "@/components/dashboard/fhe-status-poller";
import { PageHeader } from "@/components/layouts/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { VerificationFinalizationNotice } from "@/components/verification/verification-finalization-notice";
import { env } from "@/env";
import { getSecurityPostureForSession } from "@/lib/assurance/data";
import { getTierProgress } from "@/lib/assurance/features";
import { getCachedSession } from "@/lib/auth/cached-session";
import {
  getPrimaryWalletAddress,
  userHasPassword,
} from "@/lib/db/queries/auth";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";
import { cn } from "@/lib/utils/classname";
import { buildCountryDocumentList } from "@/lib/zkpassport/document-support";

import { FheErrorBanner } from "./_components/fhe-error-banner";
import { VerificationMethodCards } from "./_components/verification-method-cards";
import { VerifyCta } from "./_components/verify-cta";

export default async function VerifyPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }
  const cookies = headersObj.get("cookie");

  const [posture, bundle, hasPassword, wallet, countries] = await Promise.all([
    getSecurityPostureForSession(userId, session),
    getIdentityBundleByUserId(userId),
    userHasPassword(userId),
    getPrimaryWalletAddress(userId),
    buildCountryDocumentList(),
  ]);
  const assurance = posture.assurance;

  if (assurance.tier >= 3 && !assurance.details.missingProfileSecret) {
    redirect("/dashboard");
  }

  const hasEnrollment = Boolean(bundle?.fheKeyId);
  const hasFheError = bundle?.fheStatus === "error";
  const progress = getTierProgress(assurance);
  const { details } = assurance;
  const zkPassportEnabled = env.NEXT_PUBLIC_ZKPASSPORT_ENABLED;

  // Tier 2+ users with missing profile secret: allow re-verification
  if (assurance.tier >= 2 && assurance.details.missingProfileSecret) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Your identity data was not saved during verification. Re-verify to enable identity sharing with applications."
          title="Re-verify Identity"
        >
          <TierBadge size="md" tier={assurance.tier} />
        </PageHeader>
        <Card>
          <CardContent className="pt-6">
            <VerificationMethodCards
              countries={countries}
              zkPassportEnabled={zkPassportEnabled}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Tier 2 users: show chip upgrade if enabled, otherwise redirect
  if (assurance.tier >= 2) {
    if (!zkPassportEnabled) {
      redirect("/dashboard");
    }

    return (
      <div className="space-y-6">
        <PageHeader
          description="Some services require a higher level of assurance. Upgrade with your document's NFC chip for the strongest verification."
          title="Upgrade Verification"
        >
          <TierBadge size="md" tier={assurance.tier} />
        </PageHeader>
        <Card>
          <CardContent className="pt-6">
            <VerificationMethodCards
              countries={countries}
              zkPassportEnabled={zkPassportEnabled}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user has started OCR flow (has document or liveness progress)
  const hasStartedOcrFlow =
    details.documentVerified || details.livenessVerified;

  // Tier 1 users who haven't started any flow: show unified verification card
  if (!hasStartedOcrFlow) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Scan your document or use your document's NFC chip to verify and unlock features"
          title="Verify Your Identity"
        >
          <TierBadge size="md" tier={assurance.tier} />
        </PageHeader>

        {hasEnrollment ? (
          <Card>
            <CardContent className="pt-6">
              <VerificationMethodCards
                countries={countries}
                zkPassportEnabled={zkPassportEnabled}
              />
            </CardContent>
          </Card>
        ) : (
          <VerifyCta
            cookies={cookies}
            hasEnrollment={false}
            hasPasskeys={posture.capabilities.hasPasskeys}
            hasPassword={hasPassword}
            nextStepHref="/dashboard/verify"
            nextStepTitle="Verify Identity"
            wallet={wallet}
          />
        )}

        <PrivacyCard showChipInfo={zkPassportEnabled} />
      </div>
    );
  }

  // OCR flow in progress — show step progress
  const steps = [
    {
      id: "document",
      title: "Upload ID",
      description: "Upload a photo of your government-issued ID document",
      icon: FileText,
      completed: details.documentVerified,
      href: "/dashboard/verify/document",
    },
    {
      id: "liveness",
      title: "Liveness & Face Match",
      description:
        "Complete gesture challenges and match your face to your ID photo",
      icon: Scan,
      completed: details.livenessVerified && details.faceMatchVerified,
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
      <PageHeader
        description="Verify your identity to unlock more features"
        title="Complete Verification"
      >
        <TierBadge size="md" tier={assurance.tier} />
      </PageHeader>

      {hasFheError && bundle?.fheKeyId && (
        <FheErrorBanner fheKeyId={bundle.fheKeyId} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Verification Progress</span>
            <span className="font-normal text-muted-foreground text-sm">
              {completedSteps} of {steps.length} complete
            </span>
          </CardTitle>
          <CardDescription>
            Complete all steps to reach Verified tier
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Progress className="h-2" value={progress} />

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

          {nextStep && (
            <VerifyCta
              cookies={cookies}
              hasEnrollment={hasEnrollment}
              hasPasskeys={posture.capabilities.hasPasskeys}
              hasPassword={hasPassword}
              nextStepHref={nextStep.href}
              nextStepTitle={nextStep.title}
              wallet={wallet}
            />
          )}

          {!nextStep &&
            identityComplete &&
            details.zkProofsComplete &&
            !details.fheComplete && (
              <div className="space-y-3">
                <FheStatusPoller />
                <VerificationFinalizationNotice />
                <p className="text-muted-foreground text-sm">
                  Your verification proofs have been created. We&apos;re
                  encrypting the remaining data in the background. This page
                  will update automatically when complete.
                </p>
              </div>
            )}

          {!nextStep && identityComplete && !details.zkProofsComplete && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-sm">
                  Identity checks passed, but verification proofs could not be
                  generated.
                </span>
              </div>
              <p className="text-muted-foreground text-sm">
                To reach Verified tier, you&apos;ll need to re-upload your
                document. Proofs are generated during verification and require
                your document data, which we don&apos;t store.
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

      <PrivacyCard />
    </div>
  );
}

function PrivacyCard({ showChipInfo }: Readonly<{ showChipInfo?: boolean }>) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-1.5 text-muted-foreground text-sm">
            <p>
              <strong className="text-foreground">
                Privacy-first verification
              </strong>
            </p>
            <p>
              Your personal data is never stored in readable form.
              Zero-knowledge proofs are generated locally in your browser, and
              sensitive attributes are encrypted with fully homomorphic
              encryption (FHE). We only keep encrypted proofs of your verified
              attributes (e.g., &quot;over 18&quot;). Raw images are processed
              in memory and immediately discarded.
            </p>
            {showChipInfo && (
              <p>
                Some services require the highest level of assurance. NFC chip
                verification provides cryptographic proof directly from your
                document&apos;s secure chip, reaching the Chip Verified tier.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
