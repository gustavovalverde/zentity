"use client";

/* eslint @next/next/no-img-element: off */

import {
  ArrowLeftRight,
  Check,
  Edit2,
  KeyRound,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { NATIONALITY_GROUP } from "@/lib/attestation/policy";
import {
  ensureFheKeyRegistration,
  generateAgeProof,
  generateDocValidityProof,
  generateFaceMatchProof,
  generateNationalityProof,
  getProofChallenge,
  getSignedClaims,
  storeProof,
} from "@/lib/crypto";
import { generatePrfSalt } from "@/lib/crypto/key-derivation";
import {
  checkPrfSupport,
  createCredentialWithPrf,
  evaluatePrf,
  extractCredentialRegistrationData,
} from "@/lib/crypto/webauthn-prf";
import {
  type FaceMatchResult,
  matchFaces,
} from "@/lib/liveness/face-detection";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/liveness/liveness-policy";
import { trpc } from "@/lib/trpc/client";
import { base64UrlToBytes, cn } from "@/lib/utils";

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

type FaceMatchStatus = "idle" | "matching" | "matched" | "no_match" | "error";

type SecureStatus =
  | "idle"
  | "registering-passkey"
  | "unlocking-prf"
  | "registering-fhe"
  | "finalizing-identity"
  | "generating-proofs"
  | "storing-proofs"
  | "complete"
  | "error";

interface StepIndicatorProps {
  label: string;
  status: "pending" | "active" | "complete";
  icon: React.ReactNode;
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  Uint8Array.from(bytes).buffer;

function StepIndicator({ label, status, icon }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full transition-all",
          status === "complete" && "bg-success text-success-foreground",
          status === "active" && "bg-info text-info-foreground animate-pulse",
          status === "pending" && "bg-muted text-muted-foreground",
        )}
      >
        {status === "complete" ? (
          <Check className="h-4 w-4" />
        ) : status === "active" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          icon
        )}
      </div>
      <span
        className={cn(
          "text-sm transition-colors",
          status === "complete" && "text-success font-medium",
          status === "active" && "text-info font-medium",
          status === "pending" && "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Step 4: Create Account with Passkey
 *
 * Merged step that combines:
 * - Review extracted data from document
 * - Face matching verification
 * - Passwordless account creation via passkey
 * - FHE key registration with PRF
 * - Privacy proof generation
 */
export function StepCreateAccount() {
  const { state, updateData, setSubmitting, reset, updateServerProgress } =
    useWizard();
  const { data } = state;

  // Review state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(data.extractedName || "");

  // Face matching state
  const [faceMatchStatus, setFaceMatchStatus] =
    useState<FaceMatchStatus>("idle");
  const [faceMatchResult, setFaceMatchResult] =
    useState<FaceMatchResult | null>(null);
  const faceMatchAttemptedRef = useRef(false);

  // Passkey/secure keys state
  const [supportStatus, setSupportStatus] = useState<{
    supported: boolean;
    reason?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecureStatus>("idle");

  const hasIdentityDocs = Boolean(data.identityDraftId);
  const hasDob = Boolean(data.extractedDOB);

  // Check PRF support on mount
  useEffect(() => {
    let active = true;
    checkPrfSupport().then((result) => {
      if (active) setSupportStatus(result);
    });
    return () => {
      active = false;
    };
  }, []);

  // Get the best selfie frame for face matching
  const selfieForMatching = data.bestSelfieFrame || data.selfieImage;

  // Auto-trigger face matching when both ID and selfie are available
  useEffect(() => {
    if (faceMatchAttemptedRef.current) return;
    if (!data.idDocumentBase64 || !selfieForMatching) return;
    if (faceMatchStatus !== "idle") return;

    faceMatchAttemptedRef.current = true;

    const performFaceMatch = async () => {
      if (!data.idDocumentBase64 || !selfieForMatching) return;

      setFaceMatchStatus("matching");
      try {
        const result = await matchFaces(
          data.idDocumentBase64,
          selfieForMatching,
        );
        setFaceMatchResult(result);

        if (result.error) {
          setFaceMatchStatus("error");
        } else if (result.matched) {
          setFaceMatchStatus("matched");
        } else {
          setFaceMatchStatus("no_match");
        }
      } catch (err) {
        setFaceMatchStatus("error");
        setFaceMatchResult({
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: 0.6,
          processingTimeMs: 0,
          idFaceExtracted: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    };

    performFaceMatch();
  }, [data.idDocumentBase64, selfieForMatching, faceMatchStatus]);

  const calculateAge = (dob: string | null): number | null => {
    if (!dob) return null;
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  };

  const progressStatus = useMemo<{
    passkey: StepIndicatorProps["status"];
    prf: StepIndicatorProps["status"];
    fhe: StepIndicatorProps["status"];
    verify: StepIndicatorProps["status"];
    proofs: StepIndicatorProps["status"];
    store: StepIndicatorProps["status"];
  }>(() => {
    const steps: Array<SecureStatus> = [
      "registering-passkey",
      "unlocking-prf",
      "registering-fhe",
      "finalizing-identity",
      "generating-proofs",
      "storing-proofs",
      "complete",
    ];
    const currentIndex = steps.indexOf(status);
    const stepStatus = (index: number, active: SecureStatus) => {
      if (currentIndex > index) return "complete";
      if (status === active) return "active";
      return "pending";
    };
    return {
      passkey: stepStatus(0, "registering-passkey"),
      prf: stepStatus(1, "unlocking-prf"),
      fhe: stepStatus(2, "registering-fhe"),
      verify: stepStatus(3, "finalizing-identity"),
      proofs: stepStatus(4, "generating-proofs"),
      store: stepStatus(5, "storing-proofs"),
    };
  }, [status]);

  const handleSaveName = () => {
    updateData({ extractedName: editedName || null });
    setIsEditingName(false);
  };

  const handleCreateAccount = async () => {
    if (!supportStatus?.supported) return;

    setSubmitting(true);
    setError(null);

    try {
      // Use extracted name or edited name, fallback to email prefix
      const accountName =
        editedName || data.extractedName || data.email.split("@")[0];

      // Step 1: Register passkey and create user account
      setStatus("registering-passkey");
      const prfSalt = generatePrfSalt();

      // Get registration options from server
      const registrationOptions =
        await trpc.passkeyAuth.getRegistrationOptions.mutate({
          email: data.email,
          name: accountName,
        });

      // Build WebAuthn options with PRF
      const options: PublicKeyCredentialCreationOptions = {
        rp: {
          id: registrationOptions.rp.id,
          name: registrationOptions.rp.name,
        },
        user: {
          id: Uint8Array.from(
            new TextEncoder().encode(registrationOptions.user.id),
          ),
          name: registrationOptions.user.email,
          displayName: registrationOptions.user.name,
        },
        challenge: Uint8Array.from(
          base64UrlToBytes(registrationOptions.challenge),
        ),
        pubKeyCredParams: [
          { type: "public-key" as const, alg: -8 },
          { type: "public-key" as const, alg: -7 },
          { type: "public-key" as const, alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "required" as const,
          userVerification: "required" as const,
        },
        timeout: 60_000,
        attestation: "none" as const,
        extensions: {
          prf: {
            eval: {
              first: toArrayBuffer(prfSalt),
            },
          },
        },
      };

      // Create passkey with PRF
      const {
        credential,
        credentialId,
        prfOutput: initialPrfOutput,
      } = await createCredentialWithPrf(options);

      // Extract credential data for server storage
      const credentialData = extractCredentialRegistrationData(credential);

      // Step 2: If PRF wasn't available during registration, evaluate it now
      let prfOutput = initialPrfOutput;
      if (!prfOutput) {
        setStatus("unlocking-prf");
        const { prfOutputs } = await evaluatePrf({
          credentialIdToSalt: { [credentialId]: prfSalt },
          credentialTransports: { [credentialId]: credentialData.transports },
        });
        prfOutput =
          prfOutputs.get(credentialId) ??
          prfOutputs.values().next().value ??
          null;
      }
      if (!prfOutput) {
        throw new Error(
          "This passkey did not return PRF output. Please try a different authenticator.",
        );
      }

      // Step 3: Complete registration on server (creates user + stores credential + session)
      const registrationResult =
        await trpc.passkeyAuth.verifyRegistration.mutate({
          challengeId: registrationOptions.challengeId,
          email: data.email,
          name: accountName,
          credential: {
            credentialId: credentialData.credentialId,
            publicKey: credentialData.publicKey,
            counter: credentialData.counter,
            deviceType: credentialData.deviceType,
            backedUp: credentialData.backedUp,
            transports: credentialData.transports,
            name: "Primary Passkey",
          },
        });

      if (!registrationResult.success) {
        throw new Error("Failed to register passkey. Please try again.");
      }

      // Step 4: Register FHE keys
      setStatus("registering-fhe");
      const fheKeyInfo = await ensureFheKeyRegistration({
        enrollment: {
          credentialId,
          prfOutput,
          prfSalt,
        },
      });

      await updateServerProgress({ keysSecured: true });

      // Step 5: Finalize identity and generate proofs if documents exist
      if (hasIdentityDocs) {
        if (!data.identityDraftId) {
          throw new Error(
            "Missing identity draft. Please restart verification.",
          );
        }

        setStatus("finalizing-identity");
        const job = await trpc.identity.finalizeAsync.mutate({
          draftId: data.identityDraftId,
          fheKeyId: fheKeyInfo.keyId,
        });

        const waitForFinalization = async () => {
          const start = Date.now();
          let attempt = 0;
          while (Date.now() - start < 5 * 60 * 1000) {
            const jobStatus = await trpc.identity.finalizeStatus.query({
              jobId: job.jobId,
            });

            if (jobStatus.status === "complete") {
              if (!jobStatus.result) {
                throw new Error("Finalization completed without a result.");
              }
              return jobStatus.result;
            }
            if (jobStatus.status === "error") {
              throw new Error(
                jobStatus.error || "Identity finalization failed.",
              );
            }

            const delay = Math.min(1000 + attempt * 500, 4000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            attempt += 1;
          }

          throw new Error(
            "Finalization is taking longer than expected. Please try again shortly.",
          );
        };

        const identityResult = await waitForFinalization();

        if (!identityResult.verified) {
          const issue =
            identityResult.issues?.length && identityResult.issues[0]
              ? identityResult.issues[0]
              : null;
          throw new Error(
            issue ||
              "Identity verification did not pass. Please retake your ID photo and selfie and try again.",
          );
        }

        if (identityResult.documentId) {
          updateData({ identityDocumentId: identityResult.documentId });
        }

        // Step 6: Generate proofs
        setStatus("generating-proofs");
        const activeDocumentId =
          identityResult.documentId ?? data.identityDocumentId;
        if (!activeDocumentId) {
          throw new Error(
            "Missing document context for proof generation. Please retry verification.",
          );
        }

        const proofResults: Array<{
          circuitType:
            | "age_verification"
            | "doc_validity"
            | "nationality_membership"
            | "face_match";
          proof: string;
          publicSignals: string[];
          generationTimeMs: number;
        }> = [];

        try {
          const claims = await getSignedClaims(activeDocumentId);
          if (!claims.ocr || !claims.faceMatch) {
            throw new Error("Signed claims unavailable for proof generation");
          }

          const ocrClaim = claims.ocr;
          const faceClaim = claims.faceMatch;
          const ocrData = ocrClaim.data as {
            birthYear?: number | null;
            expiryDate?: number | null;
            nationalityCode?: string | null;
            claimHashes?: {
              age?: string | null;
              docValidity?: string | null;
              nationality?: string | null;
            };
          };
          const faceData = faceClaim.data as {
            confidence?: number;
            confidenceFixed?: number;
            thresholdFixed?: number;
            claimHash?: string | null;
          };

          const documentHashField = ocrClaim.documentHashField;
          if (!documentHashField) {
            throw new Error("Missing document hash field");
          }

          const ageClaimHash = ocrData.claimHashes?.age;
          const docValidityClaimHash = ocrData.claimHashes?.docValidity;
          const nationalityClaimHash = ocrData.claimHashes?.nationality;

          if (
            ocrData.birthYear === null ||
            ocrData.birthYear === undefined ||
            !ageClaimHash
          ) {
            throw new Error("Missing birth year claim for age proof");
          }
          if (
            ocrData.expiryDate === null ||
            ocrData.expiryDate === undefined ||
            !docValidityClaimHash
          ) {
            throw new Error("Missing expiry date claim for document proof");
          }
          if (!ocrData.nationalityCode || !nationalityClaimHash) {
            throw new Error("Missing nationality claim for membership proof");
          }
          if (!faceData.claimHash) {
            throw new Error("Missing face match claim hash");
          }

          const ageChallenge = await getProofChallenge("age_verification");
          const ageProof = await generateAgeProof(
            ocrData.birthYear,
            new Date().getFullYear(),
            18,
            {
              nonce: ageChallenge.nonce,
              documentHashField,
              claimHash: ageClaimHash,
            },
          );
          proofResults.push({
            circuitType: "age_verification",
            ...ageProof,
          });

          const docChallenge = await getProofChallenge("doc_validity");
          const now = new Date();
          const currentDateInt =
            now.getFullYear() * 10000 +
            (now.getMonth() + 1) * 100 +
            now.getDate();
          const docProof = await generateDocValidityProof(
            ocrData.expiryDate,
            currentDateInt,
            {
              nonce: docChallenge.nonce,
              documentHashField,
              claimHash: docValidityClaimHash,
            },
          );
          proofResults.push({
            circuitType: "doc_validity",
            ...docProof,
          });

          const nationalityChallenge = await getProofChallenge(
            "nationality_membership",
          );
          const nationalityProof = await generateNationalityProof(
            ocrData.nationalityCode,
            NATIONALITY_GROUP,
            {
              nonce: nationalityChallenge.nonce,
              documentHashField,
              claimHash: nationalityClaimHash,
            },
          );
          proofResults.push({
            circuitType: "nationality_membership",
            ...nationalityProof,
          });

          const similarityFixed =
            typeof faceData.confidenceFixed === "number"
              ? faceData.confidenceFixed
              : typeof faceData.confidence === "number"
                ? Math.round(faceData.confidence * 10000)
                : null;
          if (similarityFixed === null) {
            throw new Error("Missing face match confidence for proof");
          }

          const thresholdFixed =
            typeof faceData.thresholdFixed === "number"
              ? faceData.thresholdFixed
              : Math.round(FACE_MATCH_MIN_CONFIDENCE * 10000);
          if (
            faceClaim.documentHashField &&
            faceClaim.documentHashField !== documentHashField
          ) {
            throw new Error("Face match document hash mismatch");
          }
          const faceDocumentHashField =
            faceClaim.documentHashField || documentHashField;

          const faceChallenge = await getProofChallenge("face_match");
          const faceProof = await generateFaceMatchProof(
            similarityFixed,
            thresholdFixed,
            {
              nonce: faceChallenge.nonce,
              documentHashField: faceDocumentHashField,
              claimHash: faceData.claimHash,
            },
          );
          proofResults.push({
            circuitType: "face_match",
            ...faceProof,
          });
        } catch (zkError) {
          const errorMessage =
            zkError instanceof Error ? zkError.message : "Unknown error";
          const isTimeout = errorMessage.includes("timed out");
          const isWasmError =
            errorMessage.toLowerCase().includes("wasm") ||
            errorMessage.toLowerCase().includes("module");

          const friendlyMessage = isTimeout
            ? "Privacy verification is taking too long. This may be due to network issues loading cryptographic libraries. Please refresh the page and try again."
            : isWasmError
              ? "Unable to load cryptographic libraries. Please try refreshing the page. If using a VPN or content blocker, it may be blocking required resources."
              : "Privacy verification services are temporarily unavailable. Please try again in a few minutes.";

          throw new Error(friendlyMessage);
        }

        // Step 7: Store proofs
        setStatus("storing-proofs");
        for (const proof of proofResults) {
          await storeProof(
            proof.circuitType,
            proof.proof,
            proof.publicSignals,
            proof.generationTimeMs,
            activeDocumentId,
          );
        }
      }

      // Complete!
      setStatus("complete");
      reset();

      // Check for RP flow redirect
      const rpFlow = new URLSearchParams(window.location.search).get("rp_flow");
      if (rpFlow) {
        window.location.assign(
          `/api/rp/complete?flow=${encodeURIComponent(rpFlow)}`,
        );
        return;
      }
      window.location.assign("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account.";
      setError(message);
      setStatus("error");
      toast.error("Account creation failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const unsupportedMessage =
    supportStatus && !supportStatus.supported
      ? supportStatus.reason ||
        "PRF passkeys are not supported on this device or browser."
      : null;

  const hasIdentityImages = Boolean(
    data.idDocumentBase64 && (data.bestSelfieFrame || data.selfieImage),
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Create Your Account</h3>
        <p className="text-sm text-muted-foreground">
          Review your information, then create your account with a passkey.
          Passkeys are more secure than passwords and work across all your
          devices.
        </p>
        {!supportStatus && (
          <p className="text-xs text-muted-foreground">
            Checking passkey support…
          </p>
        )}
      </div>

      {unsupportedMessage && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            {unsupportedMessage}
            <div className="mt-2 text-xs text-muted-foreground">
              Supported: Chrome/Edge/Firefox with a PRF-capable passkey. Safari
              requires iCloud Keychain. Windows Hello and external keys on
              iOS/iPadOS are not supported.
            </div>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Extracted Information Review - only show when idle */}
      {status === "idle" && (
        <div className="space-y-4 rounded-lg border p-4">
          <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
            Your Information
          </h4>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="font-medium">{data.email}</span>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Name</span>
            <div className="flex items-center gap-2">
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="h-8 w-48"
                    placeholder="Enter name"
                  />
                  <Button size="sm" variant="ghost" onClick={handleSaveName}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="font-medium">
                    {editedName || data.extractedName || "Not extracted"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditedName(data.extractedName || "");
                      setIsEditingName(true);
                    }}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Date of Birth</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {data.extractedDOB || "Not extracted"}
              </span>
              {calculateAge(data.extractedDOB) !== null && (
                <Badge variant="secondary">
                  {calculateAge(data.extractedDOB)}+ years
                </Badge>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Nationality</span>
            <span className="font-medium">
              {data.extractedNationality || "Not extracted"}
            </span>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Document</span>
            <Badge variant={data.idDocument ? "default" : "outline"}>
              {data.idDocument ? "Uploaded" : "Skipped"}
            </Badge>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Liveness</span>
            <Badge variant={data.selfieImage ? "default" : "outline"}>
              {data.selfieImage ? "Verified" : "Skipped"}
            </Badge>
          </div>
        </div>
      )}

      {/* Face Matching UI - only show when idle and has docs */}
      {status === "idle" && hasIdentityImages && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Face Verification</span>
          </div>

          <div className="flex items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "w-20 h-20 rounded-lg overflow-hidden border bg-muted relative",
                  faceMatchStatus === "matching" &&
                    "ring-2 ring-info/40 ring-offset-2",
                )}
              >
                {faceMatchStatus === "matching" &&
                  !faceMatchResult?.idFaceImage && (
                    <Skeleton className="h-full w-full" />
                  )}
                {faceMatchResult?.idFaceImage ? (
                  <img
                    src={faceMatchResult.idFaceImage}
                    alt="Face extracted from your ID (preview)"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      faceMatchStatus === "matching" && "opacity-70",
                    )}
                  />
                ) : faceMatchStatus !== "matching" ? (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    ID face
                  </div>
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground">ID Photo</span>
            </div>

            <div className="flex flex-col items-center gap-1">
              {faceMatchStatus === "idle" && (
                <ArrowLeftRight className="h-6 w-6 text-muted-foreground" />
              )}
              {faceMatchStatus === "matching" && (
                <div className="flex flex-col items-center gap-1 animate-in fade-in duration-300">
                  <div className="relative">
                    <Loader2 className="h-6 w-6 animate-spin text-info" />
                    <div className="absolute inset-0 h-6 w-6 rounded-full bg-info/20 animate-ping" />
                  </div>
                  <Skeleton className="h-3 w-16 mt-1" />
                </div>
              )}
              {faceMatchStatus === "matched" && (
                <div className="animate-in zoom-in duration-300">
                  <Check className="h-6 w-6 text-success" />
                  <span className="text-xs font-medium text-success">
                    {Math.round((faceMatchResult?.confidence || 0) * 100)}%
                    match
                  </span>
                </div>
              )}
              {faceMatchStatus === "no_match" && (
                <>
                  <XCircle className="h-6 w-6 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    No match
                  </span>
                </>
              )}
              {faceMatchStatus === "error" && (
                <>
                  <XCircle className="h-6 w-6 text-warning" />
                  <span className="text-xs font-medium text-warning">
                    Error
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "w-20 h-20 rounded-lg overflow-hidden border bg-muted relative",
                  faceMatchStatus === "matching" &&
                    "ring-2 ring-info/40 ring-offset-2",
                )}
              >
                {faceMatchStatus === "matching" && !selfieForMatching && (
                  <Skeleton className="h-full w-full" />
                )}
                {selfieForMatching && (
                  <img
                    src={selfieForMatching}
                    alt="Selfie"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      faceMatchStatus === "matching" && "opacity-70",
                    )}
                  />
                )}
              </div>
              <span className="text-xs text-muted-foreground">Selfie</span>
            </div>
          </div>

          {faceMatchStatus === "matching" && (
            <p className="text-sm text-center text-muted-foreground">
              Comparing faces...
            </p>
          )}
          {faceMatchStatus === "matched" && (
            <Alert variant="success">
              <Check className="h-4 w-4" />
              <AlertDescription className="ml-2">
                Face verification successful. The selfie matches the ID
                document.
              </AlertDescription>
            </Alert>
          )}
          {faceMatchStatus === "no_match" && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="ml-2">
                The selfie does not match the ID document photo. You may
                proceed, but additional verification may be required.
              </AlertDescription>
            </Alert>
          )}
          {faceMatchStatus === "error" && (
            <Alert>
              <AlertDescription>
                Face verification could not be completed. You may proceed, but
                please ensure your ID and selfie are clear.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Passkey Info Card - only show when idle */}
      {status === "idle" && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Passkey-protected account</span>
            <Badge variant="secondary">Recommended</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Your account is protected by a passkey instead of a password.
            Passkeys are phishing-resistant and work with your device's
            biometrics (Face ID, Touch ID, Windows Hello). You can optionally
            add a recovery password later in settings.
          </p>
        </div>
      )}

      {/* Progress UI - show when creating account */}
      {status !== "idle" && status !== "error" && (
        <div className="space-y-4 rounded-lg border border-info/30 bg-info/10 p-5 text-info animate-in fade-in duration-300">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-medium">Creating your secure account</span>
          </div>

          <div className="space-y-3">
            <StepIndicator
              label="Create passkey"
              status={progressStatus.passkey}
              icon={<KeyRound className="h-4 w-4" />}
            />
            <StepIndicator
              label="Derive encryption key"
              status={progressStatus.prf}
              icon={<Loader2 className="h-4 w-4" />}
            />
            <StepIndicator
              label="Register FHE keys"
              status={progressStatus.fhe}
              icon={<ShieldCheck className="h-4 w-4" />}
            />
            {hasIdentityDocs && (
              <>
                <StepIndicator
                  label="Finalize identity"
                  status={progressStatus.verify}
                  icon={<ShieldCheck className="h-4 w-4" />}
                />
                <StepIndicator
                  label="Generate privacy proofs"
                  status={progressStatus.proofs}
                  icon={<ShieldCheck className="h-4 w-4" />}
                />
                <StepIndicator
                  label="Store proofs"
                  status={progressStatus.store}
                  icon={<ShieldCheck className="h-4 w-4" />}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      {!state.isSubmitting && (
        <WizardNavigation
          onNext={handleCreateAccount}
          nextLabel="Create Account with Passkey"
          disableNext={!supportStatus?.supported}
        />
      )}

      {/* Privacy Info - only show when idle */}
      {!state.isSubmitting && status === "idle" && (
        <Alert>
          <AlertDescription>
            <strong>Privacy-First Verification:</strong>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {hasDob && (
                <>
                  <li>
                    Your birth year is encrypted using FHE (Fully Homomorphic
                    Encryption)
                  </li>
                  <li>
                    A zero-knowledge proof verifies you are 18+ without
                    revealing your age
                  </li>
                </>
              )}
              {hasIdentityImages && (
                <>
                  <li>
                    Your ID document is processed to generate cryptographic
                    commitments
                  </li>
                  <li>
                    Face matching compares your selfie to your ID photo, then
                    both are deleted
                  </li>
                </>
              )}
              <li>
                Only commitments, proofs, signed claims, and encrypted
                attributes are stored - all PII is deleted immediately
              </li>
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
