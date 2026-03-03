import { eq } from "drizzle-orm";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileText,
  ImageUp,
  Nfc,
  Scan,
  ShieldCheck,
  SmartphoneNfc,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TierBadge } from "@/components/assurance/tier-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { env } from "@/env";
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

import { DownloadZkPassportDialog } from "./_components/download-zkpassport-dialog";
import { FheErrorBanner } from "./_components/fhe-error-banner";
import { FheStatusPoller } from "./_components/fhe-status-poller";
import { VerifyCta } from "./_components/verify-cta";

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

  if (assuranceState.tier >= 3) {
    redirect("/dashboard");
  }

  const hasEnrollment = Boolean(bundle?.fheKeyId);
  const hasFheError = bundle?.fheStatus === "error";
  const progress = getTierProgress(assuranceState);
  const { details } = assuranceState;
  const zkPassportEnabled = env.NEXT_PUBLIC_ZKPASSPORT_ENABLED;

  // Tier 2 users: show chip upgrade if enabled, otherwise redirect
  if (assuranceState.tier >= 2) {
    if (!zkPassportEnabled) {
      redirect("/dashboard");
    }

    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-2xl">Upgrade Verification</h1>
            <p className="text-muted-foreground">
              Some services require a higher level of assurance. Upgrade with
              your document&apos;s NFC chip for the strongest verification.
            </p>
          </div>
          <TierBadge size="md" tier={assuranceState.tier} />
        </div>
        <NfcMethodCard />
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-2xl">Verify Your Identity</h1>
            <p className="text-muted-foreground">
              Verify your passport, national ID, or residence permit to unlock
              features
            </p>
          </div>
          <TierBadge size="md" tier={assuranceState.tier} />
        </div>

        {hasEnrollment ? (
          <Card>
            <CardContent className="space-y-5 pt-6">
              {zkPassportEnabled && (
                <>
                  <NfcMethodSection />

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">
                        or
                      </span>
                    </div>
                  </div>
                </>
              )}

              <DocumentScanMethodSection isAlternative={zkPassportEnabled} />
            </CardContent>
          </Card>
        ) : (
          <VerifyCta
            cookies={cookies}
            hasEnrollment={false}
            hasPasskeys={Boolean(passkeyRow)}
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
              hasPasskeys={Boolean(passkeyRow)}
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
                <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 p-3 text-blue-700 dark:text-blue-400">
                  <Scan className="h-5 w-5 animate-pulse" />
                  <span className="text-sm">
                    Proofs generated. Finalizing encryption in the background...
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  Your ZK proofs have been generated. FHE encryption is being
                  finalized in the background. This page will update
                  automatically.
                </p>
              </div>
            )}

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

      <PrivacyCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification method sections
// ---------------------------------------------------------------------------

function NfcMethodSection() {
  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <Nfc className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm">NFC Chip Verification</p>
            <p className="text-muted-foreground text-xs">
              Strongest verification
            </p>
          </div>
        </div>
        <Badge variant="info">Chip Verified</Badge>
      </div>

      <p className="text-muted-foreground text-sm">
        Read the cryptographic chip embedded in your document using the
        ZKPassport app. Generates zero-knowledge proofs directly on your phone.
      </p>

      <div className="space-y-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          You&apos;ll need
        </p>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <SmartphoneNfc className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              <strong>ZKPassport app</strong> on your phone (
              <DownloadZkPassportDialog />)
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Nfc className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              NFC-enabled{" "}
              <strong>passport, national ID, or residence permit</strong>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <SmartphoneNfc className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              Phone <strong>NFC</strong> enabled
            </span>
          </li>
        </ul>
      </div>

      <Button asChild className="w-full" size="lg">
        <Link href="/dashboard/verify/passport-chip">
          Start NFC Verification
        </Link>
      </Button>
    </div>
  );
}

function NfcMethodCard() {
  return (
    <Card>
      <CardContent className="pt-6">
        <NfcMethodSection />
      </CardContent>
    </Card>
  );
}

function DocumentScanMethodSection({
  isAlternative,
}: Readonly<{ isAlternative: boolean }>) {
  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm">Document Scan</p>
            <p className="text-muted-foreground text-xs">
              {isAlternative
                ? "For documents without NFC"
                : "Photo upload + liveness check"}
            </p>
          </div>
        </div>
        <Badge variant="outline">Verified</Badge>
      </div>

      <p className="text-muted-foreground text-sm">
        Upload a photo of your government-issued document and complete a
        liveness check to verify you&apos;re the document holder.
      </p>

      <div className="space-y-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          You&apos;ll need
        </p>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <ImageUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              A <strong>photo</strong> of your government-issued ID
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              <strong>Camera access</strong> for liveness verification
            </span>
          </li>
        </ul>
      </div>

      <Button
        asChild
        className="w-full"
        size={isAlternative ? "default" : "lg"}
        variant={isAlternative ? "outline" : "default"}
      >
        <Link href="/dashboard/verify/document">
          {isAlternative
            ? "My document doesn't have NFC"
            : "Start Document Scan"}
        </Link>
      </Button>
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
              Your data is processed securely and never stored in plaintext.
              Only cryptographic commitments and zero-knowledge proofs are
              persisted. Raw images are processed in memory and discarded.
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
