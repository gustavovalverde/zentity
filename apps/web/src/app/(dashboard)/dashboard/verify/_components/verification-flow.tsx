"use client";

import type { CountryDocumentEntry } from "@/lib/identity/document/zkpassport-support";
import type {
  InitialStepContext,
  VerificationStep,
} from "@/lib/identity/verification/steps";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { useVerificationStepper } from "@/hooks/verification/use-verification";

import { DocumentUploadClient } from "./document/document-upload-client";
import { FheEnrollmentDialog } from "./fhe-enrollment-dialog";
import { LivenessVerifyClient } from "./liveness/liveness-verify-client";
import { ZkPassportFlow } from "./passport-chip/zkpassport-flow";
import { VerificationMethodCards } from "./verification-method-cards";

interface VerificationFlowProps {
  context: InitialStepContext;
  countries: CountryDocumentEntry[];
  hasPasskeys: boolean;
  hasPassword: boolean;
  initialStep: VerificationStep;
  wallet: { address: string; chainId: number } | null;
  zkPassportEnabled: boolean;
}

/**
 * Client-side step switcher for the verification flow.
 *
 * All steps render inline — enrollment, method selection,
 * document, liveness, and passport-chip advance via stepper
 * callbacks without page navigation. Terminal steps (liveness,
 * passport-chip) navigate to the dashboard on completion.
 */
export function VerificationFlow({
  initialStep,
  context,
  countries,
  hasPasskeys,
  hasPassword,
  wallet,
  zkPassportEnabled,
}: VerificationFlowProps) {
  const router = useRouter();
  const stepper = useVerificationStepper(initialStep);

  const navigateToDashboard = useCallback(() => {
    router.push("/dashboard");
    router.refresh();
  }, [router]);

  const handleEnrollmentComplete = useCallback(
    () => stepper.goTo("method"),
    [stepper]
  );

  const handleSelectDocument = useCallback(
    () => stepper.goTo("document"),
    [stepper]
  );

  const handleSelectPassportChip = useCallback(
    () => stepper.goTo("passport-chip"),
    [stepper]
  );

  const handleDocumentComplete = useCallback(
    () => stepper.goTo("liveness"),
    [stepper]
  );

  switch (stepper.currentStep) {
    case "enrollment":
      return (
        <FheEnrollmentDialog
          hasPasskeys={hasPasskeys}
          hasPassword={hasPassword}
          inline
          onComplete={handleEnrollmentComplete}
          wallet={wallet}
        />
      );

    case "method":
      return (
        <Card>
          <CardContent className="pt-6">
            <VerificationMethodCards
              countries={countries}
              onSelectDocument={handleSelectDocument}
              onSelectPassportChip={handleSelectPassportChip}
              zkPassportEnabled={zkPassportEnabled}
            />
          </CardContent>
        </Card>
      );

    case "document":
      return (
        <DocumentUploadClient
          demoMode
          onComplete={handleDocumentComplete}
          resetOnMount={context.resetOnMount}
        />
      );

    case "liveness":
      return (
        <LivenessVerifyClient
          onComplete={navigateToDashboard}
          wallet={wallet}
        />
      );

    case "passport-chip":
      return (
        <ZkPassportFlow onComplete={navigateToDashboard} wallet={wallet} />
      );

    default: {
      const _exhaustive: never = stepper.currentStep;
      return null;
    }
  }
}
