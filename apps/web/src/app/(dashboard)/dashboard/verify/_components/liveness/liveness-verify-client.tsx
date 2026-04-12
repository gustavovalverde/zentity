"use client";

import type { FaceMatchResult } from "@/lib/identity/liveness/challenges";
import type { BindingContext } from "@/lib/identity/verification/finalize-and-prove";

import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useVerificationBindingAuth } from "@/hooks/verification/use-verification";
import { useSession } from "@/lib/auth/auth-client";
import { generateAllProofs } from "@/lib/identity/verification/finalize-and-prove";
import {
  buildProfileSecretDataFromOcrSnapshot,
  storeProfileSecretWithMaterial,
} from "@/lib/identity/verification/profile-vault";
import { useVerificationStore } from "@/lib/identity/verification/store";
import {
  getCachedBindingMaterial,
  setCachedBindingMaterial,
} from "@/lib/privacy/credentials/cache";
import { assertProfileSecretStored } from "@/lib/privacy/secrets/profile";
import {
  acquirePasskeyMaterial,
  detectAuthMode,
  getBindingContext,
} from "@/lib/privacy/zk/binding-context";
import { trpc } from "@/lib/trpc/client";

import { BindingAuthDialog } from "../binding-auth-dialog";
import { FaceVerificationCard } from "../face-verification-card";
import { LivenessFlow } from "./liveness-flow";
import { LivenessProvider } from "./liveness-provider";

const getStoreState = () => useVerificationStore.getState();

type FaceMatchStatus = "idle" | "matching" | "matched" | "no_match" | "error";

/**
 * Wait for liveness results to be written to the draft with retry logic.
 */
async function waitForLivenessWrite(
  draftId: string,
  maxAttempts = 5
): Promise<{ success: boolean; issues: string[] }> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await trpc.identity.livenessStatus.mutate({ draftId });
    if (status.success) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1)));
  }
  return trpc.identity.livenessStatus.mutate({ draftId });
}

function getLivenessIssueMessage(issue: string): string {
  const issueMessages: Record<string, string> = {
    draft_not_found:
      "This verification session is no longer active. Refresh and restart from the verification page.",
    liveness_not_completed: "Selfie check not recorded",
    face_match_not_completed: "Face matching not recorded",
  };

  return issueMessages[issue] || issue;
}

function getFinalizeFailureMessage(jobStatus: {
  error?: string;
  result?: {
    issues?: string[];
    verified?: boolean;
  } | null;
}): string | null {
  if (jobStatus.error) {
    return jobStatus.error;
  }

  const issues = jobStatus.result?.issues ?? [];
  if (issues.includes("document_hash_field_failed")) {
    return "We couldn't prepare your document data for verification. Please retry the document step.";
  }
  if (
    issues.includes("signed_ocr_claim_failed") ||
    issues.includes("signed_face_match_claim_failed") ||
    issues.includes("signed_liveness_claim_failed")
  ) {
    return "We couldn't prepare your verification data. Please retry verification.";
  }
  if (issues.length > 0) {
    return issues.map(getLivenessIssueMessage).join(", ");
  }
  if (jobStatus.result?.verified === false) {
    return "Verification finalization did not complete successfully. Please retry.";
  }

  return null;
}

interface LivenessVerifyClientProps {
  onComplete?: () => void;
  wallet: { address: string; chainId: number } | null;
}

export function LivenessVerifyClient({
  onComplete,
  wallet,
}: Readonly<LivenessVerifyClientProps>) {
  const router = useRouter();
  const store = useVerificationStore();
  const { data: session } = useSession();
  const [livenessCompleted, setLivenessCompleted] = useState(false);
  const [faceMatchStatus, setFaceMatchStatus] =
    useState<FaceMatchStatus>("idle");
  const [faceMatchResult, setFaceMatchResult] =
    useState<FaceMatchResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const baseId = useId();
  const [retryCount, setRetryCount] = useState(0);
  const livenessKey = `${baseId}-${retryCount}`;

  const {
    bindingAuthMode,
    bindingAuthOpen,
    requestBindingAuth,
    setBindingAuthOpen,
  } = useVerificationBindingAuth();
  // Ref to hold the verificationId while dialog is open (avoids stale closure)
  const pendingVerificationIdRef = useRef<string | null>(null);

  const handleBindingAuthOpenChange = useCallback(
    (open: boolean) => {
      setBindingAuthOpen(open);
      if (!open && pendingVerificationIdRef.current) {
        pendingVerificationIdRef.current = null;
        setIsSubmitting(false);
      }
    },
    [setBindingAuthOpen]
  );

  const userId = session?.user?.id;
  const draftId = store.draftId;

  const persistProfileSecret = useCallback(async (): Promise<
    "stored" | "pending"
  > => {
    if (!userId) {
      throw new Error("Session expired. Please sign in again.");
    }

    let cachedBindingMaterial = getCachedBindingMaterial();
    if (!cachedBindingMaterial) {
      const authModeInfo = await detectAuthMode();
      if (!authModeInfo) {
        throw new Error(
          "No credential is available to encrypt your identity data."
        );
      }

      if (authModeInfo.mode === "passkey" && authModeInfo.passkeyCreds) {
        const material = await acquirePasskeyMaterial(
          authModeInfo.passkeyCreds
        );
        if (!material) {
          throw new Error(
            "Passkey confirmation was cancelled before your identity data could be saved."
          );
        }

        setCachedBindingMaterial(material);
        cachedBindingMaterial = material;
      } else {
        requestBindingAuth(authModeInfo.mode as "opaque" | "wallet");
        return "pending";
      }
    }

    const outcome = await storeProfileSecretWithMaterial({
      cachedBindingMaterial,
      profileData: buildProfileSecretDataFromOcrSnapshot(getStoreState()),
      userId,
      wallet,
    });

    if (outcome !== "stored") {
      throw new Error(
        "The credential required to encrypt your identity data is unavailable."
      );
    }

    return "stored";
  }, [requestBindingAuth, userId, wallet]);

  /**
   * Execute proof generation with a resolved binding context.
   */
  const runProofGeneration = useCallback(
    async (verificationId: string, bindingContext: BindingContext) => {
      toast.info("Verifying your information...", {
        description: "This takes up to 30 seconds. Please keep this page open.",
      });

      const storeState = getStoreState();
      await generateAllProofs({
        verificationId,
        profilePayload: null,
        extractedDOB: storeState.extractedDOB,
        extractedExpirationDate: storeState.extractedExpirationDate,
        extractedNationalityCode: storeState.extractedNationalityCode,
        bindingContext,
      });

      await assertProfileSecretStored();

      toast.success("Verification complete!", {
        description: "Your verification records have been created.",
      });

      // Privacy hardening: purge transient PII once proofs are generated.
      getStoreState().reset();

      if (onComplete) {
        onComplete();
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    },
    [onComplete, router]
  );

  /**
   * Retrieve binding context, then generate and store all ZK proofs.
   * Called directly from handleContinue or resumed after re-auth dialog.
   */
  const generateProofsWithBinding = useCallback(
    async (verificationId: string) => {
      if (!userId) {
        throw new Error("Session expired. Please sign in again.");
      }

      const bindingResult = await getBindingContext(userId, verificationId);

      if (!bindingResult.success) {
        if (
          bindingResult.reason === "cache_expired" &&
          bindingResult.authMode &&
          bindingResult.authMode !== "passkey"
        ) {
          // Pause: show re-auth dialog, resume on success
          pendingVerificationIdRef.current = verificationId;
          requestBindingAuth(bindingResult.authMode);
          return;
        }
        // Unrecoverable — no wrappers, passkey cancelled, or error
        throw new Error(bindingResult.message);
      }

      await runProofGeneration(verificationId, bindingResult.context);
    },
    [requestBindingAuth, userId, runProofGeneration]
  );

  /**
   * Called when BindingAuthDialog succeeds — cache is now populated.
   * Retries getBindingContext (which will find the fresh cache) and generates proofs.
   */
  const handleBindingAuthSuccess = useCallback(async () => {
    setBindingAuthOpen(false);
    const verificationId = pendingVerificationIdRef.current;
    if (!(verificationId && userId)) {
      return;
    }

    try {
      await persistProfileSecret();
      const bindingResult = await getBindingContext(userId, verificationId);
      if (!bindingResult.success) {
        throw new Error(bindingResult.message);
      }
      await runProofGeneration(verificationId, bindingResult.context);
    } catch (error) {
      toast.error("Proof generation failed", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      pendingVerificationIdRef.current = null;
      setIsSubmitting(false);
    }
  }, [userId, persistProfileSecret, runProofGeneration, setBindingAuthOpen]);

  const handleVerified = useCallback(
    async ({
      selfieImage,
      bestSelfieFrame,
    }: Readonly<{
      selfieImage: string;
      bestSelfieFrame: string;
    }>) => {
      const storeState = getStoreState();
      storeState.set({ selfieImage, bestSelfieFrame });
      setLivenessCompleted(true);

      if (!storeState.idDocumentBase64) {
        toast.error("Verification session expired", {
          description: "Please upload your document again to continue.",
        });
        router.replace("/dashboard/verify");
        return;
      }

      setFaceMatchStatus("matching");
      try {
        const result = await trpc.liveness.faceMatch.mutate({
          idImage: storeState.idDocumentBase64,
          selfieImage: bestSelfieFrame || selfieImage,
          draftId: draftId ?? undefined,
        });

        setFaceMatchResult({
          matched: result.matched,
          confidence: result.confidence,
          distance: result.distance,
          threshold: result.threshold,
          processingTimeMs: result.processingTimeMs,
          idFaceExtracted: result.idFaceExtracted,
          idFaceImage: "idFaceImage" in result ? result.idFaceImage : undefined,
          error: result.error ?? undefined,
        });

        if (result.matched) {
          setFaceMatchStatus("matched");
          toast.success("Face match successful!", {
            description:
              "Click 'Complete Verification' to generate your privacy proofs.",
          });
        } else {
          setFaceMatchStatus("no_match");
          toast.warning("Face match failed", {
            description:
              "Your selfie did not match the document photo. Retry with better lighting and keep your face centered.",
          });
        }
      } catch (error) {
        setFaceMatchStatus("error");
        toast.error("Face matching failed", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
      }
    },
    [draftId, router]
  );

  const handleReset = useCallback(() => {
    getStoreState().set({
      selfieImage: null,
      bestSelfieFrame: null,
    });
    setLivenessCompleted(false);
    setFaceMatchStatus("idle");
    setFaceMatchResult(null);
    setRetryCount((c) => c + 1);
  }, []);

  const handleSessionError = useCallback(() => {
    toast.error("Session expired", {
      description: "Please start the verification process again.",
    });
    router.push("/dashboard/verify");
  }, [router]);

  const handleContinue = useCallback(async () => {
    if (!livenessCompleted) {
      toast.error("Please complete the selfie check first");
      return;
    }

    if (!draftId) {
      toast.error("Missing verification data", {
        description: "Please complete the verification steps again.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Step 1: Verify liveness results persisted
      const status = await waitForLivenessWrite(draftId);
      if (!status.success) {
        const message =
          status.issues.map(getLivenessIssueMessage).join(", ") ||
          "Verification incomplete";
        throw new Error(message);
      }

      // Step 2: Trigger finalization
      const { jobId } = await trpc.identity.finalize.mutate({ draftId });

      // Step 3: Poll for job completion
      let verificationId: string | null = null;
      for (let attempts = 0; attempts < 30; attempts++) {
        const jobStatus = await trpc.identity.finalizeStatus.query({ jobId });
        if (jobStatus.status === "complete") {
          const finalizeFailure = getFinalizeFailureMessage(jobStatus);
          if (finalizeFailure) {
            throw new Error(finalizeFailure);
          }
          verificationId = jobStatus.result?.verificationId ?? null;
          break;
        }
        if (jobStatus.status === "error") {
          throw new Error(jobStatus.error ?? "Finalization failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!verificationId) {
        throw new Error("Finalization timed out");
      }

      getStoreState().set({ verificationId });

      const profileSecretOutcome = await persistProfileSecret();
      if (profileSecretOutcome === "pending") {
        pendingVerificationIdRef.current = verificationId;
        return;
      }

      // Step 4: Get binding context and generate proofs
      // If cache is expired, this opens the re-auth dialog and returns early.
      // The dialog's onSuccess callback resumes proof generation.
      await generateProofsWithBinding(verificationId);

      // If we reach here without the dialog opening, proofs are done
      if (!pendingVerificationIdRef.current) {
        setIsSubmitting(false);
      }
      // Otherwise isSubmitting stays true until dialog flow completes
    } catch (error) {
      toast.error("Verification incomplete", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
      setIsSubmitting(false);
    }
  }, [
    livenessCompleted,
    draftId,
    generateProofsWithBinding,
    persistProfileSecret,
  ]);

  const isReadyToComplete = livenessCompleted && faceMatchStatus === "matched";

  return (
    <div className="space-y-6">
      <LivenessProvider
        draftId={draftId ?? undefined}
        key={livenessKey}
        onReset={handleReset}
        onSessionError={handleSessionError}
        onVerified={handleVerified}
        userId={userId}
      >
        <LivenessFlow />
      </LivenessProvider>

      {livenessCompleted && faceMatchStatus !== "idle" && (
        <FaceVerificationCard
          result={faceMatchResult}
          selfieImage={store.bestSelfieFrame || store.selfieImage}
          status={faceMatchStatus}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Privacy Notice</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>
            Your selfie is used only for face matching with your ID and is never
            stored. Only a tamper-proof fingerprint of the verification frame is
            kept. Gesture challenges confirm you&apos;re a real person.
          </CardDescription>
        </CardContent>
      </Card>

      {livenessCompleted && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>Want to try again with a better selfie?</span>
            <Button onClick={handleReset} size="sm" variant="outline">
              Retry Liveness
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {(faceMatchStatus === "no_match" || faceMatchStatus === "error") && (
        <Alert variant="destructive">
          <AlertDescription>
            {faceMatchStatus === "no_match"
              ? "Face match is required to complete verification. Retry liveness with better lighting and keep your face centered in frame."
              : "Face verification could not be completed. Retry liveness to continue."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-3">
        <Button
          disabled={!isReadyToComplete || isSubmitting}
          onClick={handleContinue}
        >
          {isSubmitting ? <Spinner className="mr-2 size-4" /> : null}
          Complete Verification
        </Button>
      </div>

      {userId && (
        <BindingAuthDialog
          authMode={bindingAuthMode}
          onOpenChange={handleBindingAuthOpenChange}
          onSuccess={handleBindingAuthSuccess}
          open={bindingAuthOpen}
          userId={userId}
          wallet={wallet}
        />
      )}
    </div>
  );
}
