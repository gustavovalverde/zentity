"use client";

import {
  Check,
  KeyRound,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
} from "@/lib/crypto/webauthn-prf";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/liveness/liveness-policy";
import { trpc } from "@/lib/trpc/client";
import { base64UrlToBytes, cn } from "@/lib/utils";

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

type SecureStatus =
  | "idle"
  | "registering-passkey"
  | "unlocking-prf"
  | "registering-fhe"
  | "verifying-identity"
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

export function StepSecureKeys() {
  const { state, updateData, setSubmitting, reset, updateServerProgress } =
    useWizard();
  const { data } = state;
  const [supportStatus, setSupportStatus] = useState<{
    supported: boolean;
    reason?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecureStatus>("idle");

  const hasIdentityDocs = Boolean(
    data.idDocumentBase64 && (data.bestSelfieFrame || data.selfieImage),
  );
  const hasDob = Boolean(data.extractedDOB);

  useEffect(() => {
    let active = true;
    checkPrfSupport().then((result) => {
      if (active) setSupportStatus(result);
    });
    return () => {
      active = false;
    };
  }, []);

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
      "verifying-identity",
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
      verify: stepStatus(3, "verifying-identity"),
      proofs: stepStatus(4, "generating-proofs"),
      store: stepStatus(5, "storing-proofs"),
    };
  }, [status]);

  const buildPasskeyOptions = async (prfSalt: Uint8Array) => {
    const user = await trpc.secrets.getPasskeyUser.query();
    const existingBundle = await trpc.secrets.getSecretBundle.query({
      secretType: "fhe_keys",
    });
    const excludeCredentials =
      existingBundle?.wrappers?.map((wrapper) => ({
        type: "public-key" as const,
        id: toArrayBuffer(base64UrlToBytes(wrapper.credentialId)),
      })) ?? [];

    return {
      rp: {
        id: window.location.hostname,
        name: "Zentity",
      },
      user: {
        id: new TextEncoder().encode(user.userId),
        name: user.email,
        displayName: user.displayName,
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
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
      excludeCredentials,
      extensions: {
        prf: {
          eval: {
            first: toArrayBuffer(prfSalt),
          },
        },
      },
    } satisfies PublicKeyCredentialCreationOptions;
  };

  const handleSecureKeys = async () => {
    if (!supportStatus?.supported) return;

    setSubmitting(true);
    setError(null);

    try {
      setStatus("registering-passkey");
      const prfSalt = generatePrfSalt();
      const options = await buildPasskeyOptions(prfSalt);
      const { credentialId, prfOutput: initialPrfOutput } =
        await createCredentialWithPrf(options);

      let prfOutput = initialPrfOutput;
      if (!prfOutput) {
        setStatus("unlocking-prf");
        const { prfOutputs } = await evaluatePrf({
          credentialIdToSalt: { [credentialId]: prfSalt },
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

      setStatus("registering-fhe");
      const fheKeyInfo = await ensureFheKeyRegistration({
        enrollment: {
          credentialId,
          prfOutput,
          prfSalt,
        },
      });

      await updateServerProgress({ keysSecured: true });

      if (hasIdentityDocs) {
        setStatus("verifying-identity");
        const selfieToVerify = data.bestSelfieFrame || data.selfieImage;
        if (!data.idDocumentBase64 || !selfieToVerify) {
          throw new Error("Missing identity images for verification.");
        }

        const identityResult = await trpc.identity.verify.mutate({
          documentImage: data.idDocumentBase64,
          selfieImage: selfieToVerify,
          fheKeyId: fheKeyInfo.keyId,
          fhePublicKey: fheKeyInfo.publicKey,
        });

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

      setStatus("complete");
      reset();
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
          : "An unexpected error occurred while securing keys.";
      setError(message);
      setStatus("error");
      toast.error("Secure keys failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  const unsupportedMessage =
    supportStatus && !supportStatus.supported
      ? supportStatus.reason ||
        "PRF passkeys are not supported on this device or browser."
      : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Secure Your Encryption Keys</h3>
        <p className="text-sm text-muted-foreground">
          A passkey protects your homomorphic encryption keys so only you can
          unlock them. This is the foundation for private, multi-device access.
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

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">Passkey-protected keys</span>
          <Badge variant="secondary">Recommended</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          We generate FHE keys locally, encrypt them with a passkey-derived key,
          and store only ciphertext on the server. Your passkey can later be
          reused for authentication without exposing encryption material.
        </p>
      </div>

      {status !== "idle" && status !== "error" && (
        <div className="space-y-4 rounded-lg border border-info/30 bg-info/10 p-5 text-info animate-in fade-in duration-300">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-medium">Securing your keys</span>
          </div>

          <div className="space-y-3">
            <StepIndicator
              label="Create passkey"
              status={progressStatus.passkey}
              icon={<KeyRound className="h-4 w-4" />}
            />
            <StepIndicator
              label="Derive PRF key"
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
                  label="Verify identity"
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

      {!state.isSubmitting && (
        <WizardNavigation
          onNext={handleSecureKeys}
          nextLabel="Create Passkey & Secure Keys"
          disableNext={!supportStatus?.supported}
        />
      )}

      {!state.isSubmitting && (
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
              {hasIdentityDocs && (
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
