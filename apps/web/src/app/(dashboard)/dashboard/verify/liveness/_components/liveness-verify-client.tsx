"use client";

import type { FaceMatchResult } from "@/lib/identity/liveness/face-match";
import type { BindingContext } from "@/lib/identity/verification/finalize-and-prove";

import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { LivenessFlow } from "@/components/liveness/liveness-flow";
import { LivenessProvider } from "@/components/liveness/liveness-provider";
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
import { FaceVerificationCard } from "@/components/verification/face-verification-card";
import { useSession } from "@/lib/auth/auth-client";
import { generateAllProofs } from "@/lib/identity/verification/finalize-and-prove";
import { getBindingContext } from "@/lib/privacy/zk/binding-context";
import { trpc } from "@/lib/trpc/client";
import { useVerificationStore } from "@/store/verification";

import { BindingAuthDialog } from "./binding-auth-dialog";

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

interface LivenessVerifyClientProps {
  wallet: { address: string; chainId: number } | null;
}

export function LivenessVerifyClient({
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

  // Binding auth dialog state
  const [bindingAuthOpen, setBindingAuthOpen] = useState(false);
  const [bindingAuthMode, setBindingAuthMode] = useState<"opaque" | "wallet">(
    "opaque"
  );
  // Ref to hold the documentId while dialog is open (avoids stale closure)
  const pendingDocumentIdRef = useRef<string | null>(null);

  const userId = session?.user?.id;
  const draftId = store.draftId;

  /**
   * Execute proof generation with a resolved binding context.
   */
  const runProofGeneration = useCallback(
    async (documentId: string, bindingContext: BindingContext) => {
      toast.info("Generating privacy proofs...", {
        description: "This may take a moment. Please don't close this page.",
      });

      const storeState = getStoreState();
      await generateAllProofs({
        documentId,
        profilePayload: null,
        extractedDOB: storeState.extractedDOB,
        extractedExpirationDate: storeState.extractedExpirationDate,
        extractedNationalityCode: storeState.extractedNationalityCode,
        bindingContext,
      });

      toast.success("Verification complete!", {
        description: "Privacy proofs generated successfully.",
      });

      router.push("/dashboard/verify");
      router.refresh();
    },
    [router]
  );

  /**
   * Retrieve binding context, then generate and store all ZK proofs.
   * Called directly from handleContinue or resumed after re-auth dialog.
   */
  const generateProofsWithBinding = useCallback(
    async (documentId: string) => {
      if (!userId) {
        throw new Error("Session expired. Please sign in again.");
      }

      const bindingResult = await getBindingContext(userId, documentId);

      if (!bindingResult.success) {
        if (
          bindingResult.reason === "cache_expired" &&
          bindingResult.authMode &&
          bindingResult.authMode !== "passkey"
        ) {
          // Pause: show re-auth dialog, resume on success
          pendingDocumentIdRef.current = documentId;
          setBindingAuthMode(bindingResult.authMode);
          setBindingAuthOpen(true);
          return;
        }
        // Unrecoverable — no wrappers, passkey cancelled, or error
        throw new Error(bindingResult.message);
      }

      await runProofGeneration(documentId, bindingResult.context);
    },
    [userId, runProofGeneration]
  );

  /**
   * Called when BindingAuthDialog succeeds — cache is now populated.
   * Retries getBindingContext (which will find the fresh cache) and generates proofs.
   */
  const handleBindingAuthSuccess = useCallback(async () => {
    setBindingAuthOpen(false);
    const documentId = pendingDocumentIdRef.current;
    if (!(documentId && userId)) {
      return;
    }

    try {
      const bindingResult = await getBindingContext(userId, documentId);
      if (!bindingResult.success) {
        throw new Error(bindingResult.message);
      }
      await runProofGeneration(documentId, bindingResult.context);
    } catch (error) {
      toast.error("Proof generation failed", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      pendingDocumentIdRef.current = null;
      setIsSubmitting(false);
    }
  }, [userId, runProofGeneration]);

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
        router.replace("/dashboard/verify/document");
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
          toast.success("Verification complete!", {
            description: "Your identity has been verified successfully.",
          });
        } else {
          setFaceMatchStatus("no_match");
          toast.warning("Face match inconclusive", {
            description:
              "The selfie may not clearly match your document photo.",
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
      toast.error("Please complete liveness verification first");
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
        const issueMessages: Record<string, string> = {
          liveness_not_completed: "Liveness verification not recorded",
          face_match_not_completed: "Face matching not recorded",
        };
        const message =
          status.issues.map((i) => issueMessages[i] || i).join(", ") ||
          "Verification incomplete";
        throw new Error(message);
      }

      // Step 2: Trigger finalization
      const { jobId } = await trpc.identity.finalize.mutate({ draftId });

      // Step 3: Poll for job completion
      let documentId: string | null = null;
      for (let attempts = 0; attempts < 30; attempts++) {
        const jobStatus = await trpc.identity.finalizeStatus.query({ jobId });
        if (jobStatus.status === "complete") {
          documentId = jobStatus.result?.documentId ?? null;
          break;
        }
        if (jobStatus.status === "error") {
          throw new Error(jobStatus.error ?? "Finalization failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!documentId) {
        throw new Error("Finalization timed out");
      }

      getStoreState().set({ documentId });

      // Step 4: Get binding context and generate proofs
      // If cache is expired, this opens the re-auth dialog and returns early.
      // The dialog's onSuccess callback resumes proof generation.
      await generateProofsWithBinding(documentId);

      // If we reach here without the dialog opening, proofs are done
      if (!pendingDocumentIdRef.current) {
        setIsSubmitting(false);
      }
      // Otherwise isSubmitting stays true until dialog flow completes
    } catch (error) {
      toast.error("Failed to save verification", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
      setIsSubmitting(false);
    }
  }, [livenessCompleted, draftId, generateProofsWithBinding]);

  const isVerified =
    livenessCompleted &&
    (faceMatchStatus === "matched" || faceMatchStatus === "no_match");

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
            Your selfie is captured for face matching with your ID, then deleted
            after verification. Randomized gestures confirm you're a real
            person.
          </CardDescription>
        </CardContent>
      </Card>

      {livenessCompleted && (
        <Alert>
          <AlertDescription className="flex items-center justify-between">
            <span>Want to try again with a better selfie?</span>
            <Button onClick={handleReset} size="sm" variant="outline">
              Retry Liveness
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-3">
        <Button disabled={!isVerified || isSubmitting} onClick={handleContinue}>
          {isSubmitting ? <Spinner className="mr-2 size-4" /> : null}
          Complete Verification
        </Button>
      </div>

      {userId && (
        <BindingAuthDialog
          authMode={bindingAuthMode}
          onOpenChange={setBindingAuthOpen}
          onSuccess={handleBindingAuthSuccess}
          open={bindingAuthOpen}
          userId={userId}
          wallet={wallet}
        />
      )}
    </div>
  );
}
