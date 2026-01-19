"use client";

import type { FaceMatchResult } from "@/lib/identity/liveness/face-match";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
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
import { getBindingContext } from "@/lib/privacy/crypto/binding-context";
import { trpc } from "@/lib/trpc/client";
import { useVerificationStore } from "@/store/verification";

// Direct store access for effects (avoids dependency array issues)
const getStoreState = () => useVerificationStore.getState();

type FaceMatchStatus = "idle" | "matching" | "matched" | "no_match" | "error";

/**
 * Dashboard Liveness Verification Client
 *
 * Wraps the LivenessProvider and LivenessFlow components.
 * After successful liveness, performs face matching and saves results.
 *
 * Security: draftId and userId are passed to socket and faceMatch to enable
 * server-side result persistence. The server writes results directly to the
 * database - clients cannot forge liveness or face match results.
 */
/**
 * Wait for liveness results to be written to the draft with retry logic.
 * Handles race conditions where socket writes complete after client checks status.
 */
async function waitForLivenessWrite(
  draftId: string,
  maxAttempts = 5
): Promise<{ success: boolean; issues: string[] }> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await trpc.identity.livenessStatus.mutate({
      draftId,
    });
    if (status.success) {
      return status;
    }
    // Exponential backoff: 200ms, 400ms, 600ms, 800ms, 1000ms
    await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1)));
  }
  // Return last attempt's result
  return trpc.identity.livenessStatus.mutate({ draftId });
}

export function LivenessVerifyClient() {
  const router = useRouter();
  const store = useVerificationStore();
  const { data: session } = useSession();
  const [livenessCompleted, setLivenessCompleted] = useState(false);
  const [faceMatchStatus, setFaceMatchStatus] =
    useState<FaceMatchStatus>("idle");
  const [faceMatchResult, setFaceMatchResult] =
    useState<FaceMatchResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userId = session?.user?.id;
  const draftId = store.draftId;

  // Handle successful liveness verification
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

      // Automatically start face matching
      if (!storeState.idDocumentBase64) {
        toast.error("Missing document image", {
          description: "Please go back and upload your document again.",
        });
        return;
      }

      setFaceMatchStatus("matching");
      try {
        // Pass draftId so server writes results directly to database
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
    [draftId]
  );

  // Handle reset (user retrying)
  const handleReset = useCallback(() => {
    getStoreState().set({
      selfieImage: null,
      bestSelfieFrame: null,
    });
    setLivenessCompleted(false);
    setFaceMatchStatus("idle");
    setFaceMatchResult(null);
  }, []);

  // Handle session error
  const handleSessionError = useCallback(() => {
    toast.error("Session expired", {
      description: "Please start the verification process again.",
    });
    router.push("/dashboard/verify");
  }, [router]);

  // Submit verification and proceed
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
      // Step 1: Check that liveness results were persisted by socket/faceMatch
      // Uses retry logic to handle race conditions with socket write
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

      // Step 2: Trigger finalization to create signed claims
      const { jobId } = await trpc.identity.finalize.mutate({
        draftId,
      });

      // Step 3: Poll for job completion (with timeout)
      const maxAttempts = 30;
      let attempts = 0;
      let documentId: string | null = null;
      while (attempts < maxAttempts) {
        const jobStatus = await trpc.identity.finalizeStatus.query({ jobId });
        if (jobStatus.status === "complete") {
          documentId = jobStatus.result?.documentId ?? null;
          break;
        }
        if (jobStatus.status === "error") {
          throw new Error(jobStatus.error ?? "Finalization failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        attempts++;
      }

      // Step 4: Generate ZK proofs (client-side)
      if (documentId) {
        const storeState = getStoreState();
        storeState.set({ documentId });
        toast.info("Generating privacy proofs...", {
          description: "This may take a moment. Please don't close this page.",
        });

        try {
          // Attempt to get binding context for identity binding proof
          // This proves the proofs are bound to this user's authentication
          console.log(
            "[liveness] Preparing binding context - userId:",
            userId,
            "documentId:",
            documentId
          );

          if (!userId) {
            console.warn(
              "[liveness] userId is null/undefined, skipping binding context"
            );
          }

          const bindingResult = userId
            ? await getBindingContext(userId, documentId)
            : null;

          console.log(
            "[liveness] Binding result:",
            bindingResult?.success
              ? "SUCCESS"
              : bindingResult?.reason || "skipped (no userId)"
          );

          if (bindingResult && !bindingResult.success) {
            // Log binding context failure but continue with other proofs
            console.warn(
              "[liveness] Binding context unavailable:",
              bindingResult.reason,
              "-",
              bindingResult.message
            );
            if (bindingResult.reason === "cache_expired") {
              toast.info("Authentication session expired", {
                description:
                  "Identity binding proof skipped. Sign in again to complete all proofs.",
              });
            } else if (bindingResult.reason === "no_wrappers") {
              toast.info("FHE keys not yet enrolled", {
                description:
                  "Identity binding proof skipped. Complete account setup first.",
              });
            } else {
              toast.info("Identity binding proof skipped", {
                description: bindingResult.message,
              });
            }
          }

          await generateAllProofs({
            documentId,
            profilePayload: null,
            extractedDOB: storeState.extractedDOB,
            extractedExpirationDate: storeState.extractedExpirationDate,
            extractedNationalityCode: storeState.extractedNationalityCode,
            bindingContext: bindingResult?.success
              ? bindingResult.context
              : undefined,
          });
          toast.success("Verification complete!", {
            description: "Privacy proofs generated successfully.",
          });
        } catch (proofError) {
          // Log but don't block - user can retry proof generation later
          console.error("Proof generation failed:", proofError);
          toast.warning("Verification saved", {
            description:
              "Identity verified but privacy proofs need to be regenerated.",
          });
        }
      } else {
        toast.success("Verification complete!");
      }

      router.push("/dashboard/verify");
      router.refresh();
    } catch (error) {
      toast.error("Failed to save verification", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [livenessCompleted, draftId, router, userId]);

  const isVerified =
    livenessCompleted &&
    (faceMatchStatus === "matched" || faceMatchStatus === "no_match");

  return (
    <div className="space-y-6">
      <LivenessProvider
        draftId={draftId ?? undefined}
        onReset={handleReset}
        onSessionError={handleSessionError}
        onVerified={handleVerified}
        userId={userId}
      >
        <LivenessFlow />
      </LivenessProvider>

      {/* Face Match Result */}
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

      {/* Retry Button */}
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

      {/* Navigation */}
      <div className="flex justify-end gap-3">
        <Button disabled={!isVerified || isSubmitting} onClick={handleContinue}>
          {isSubmitting ? <Spinner className="mr-2 size-4" /> : null}
          Complete Verification
        </Button>
      </div>
    </div>
  );
}
