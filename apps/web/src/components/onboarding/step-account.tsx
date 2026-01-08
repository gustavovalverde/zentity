"use client";

/* eslint @next/next/no-img-element: off */

import {
  ArrowLeftRight,
  Check,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { NATIONALITY_GROUP } from "@/lib/attestation/policy";
import { authClient } from "@/lib/auth/auth-client";
import {
  isPasskeyAlreadyRegistered,
  registerPasskeyWithPrf,
  signInWithPasskey,
} from "@/lib/auth/passkey";
import {
  generateAgeProof,
  generateDocValidityProof,
  generateFaceMatchProof,
  generateNationalityProof,
  getProofChallenge,
  getSignedClaims,
  prepareFheKeyEnrollment,
  registerFheKeyForEnrollment,
  storeProof,
} from "@/lib/crypto/crypto-client";
import {
  cacheFheKeys,
  FHE_SECRET_TYPE,
  uploadSecretBlobWithToken,
} from "@/lib/crypto/fhe-key-store";
import { generatePrfSalt } from "@/lib/crypto/key-derivation";
import {
  PASSKEY_VAULT_VERSION,
  WRAP_VERSION,
} from "@/lib/crypto/passkey-vault";
import {
  type ProfileSecretPayload,
  storeProfileSecret,
} from "@/lib/crypto/profile-secret";
import { cachePasskeyUnlock } from "@/lib/crypto/secret-vault";
import { checkPrfSupport } from "@/lib/crypto/webauthn-prf";
import {
  calculateBirthYearOffsetFromYear,
  parseBirthYearFromDob,
} from "@/lib/identity/birth-year";
import { countryCodeToNumeric } from "@/lib/identity/compliance";
import {
  type FaceMatchResult,
  matchFaces,
} from "@/lib/liveness/face-detection";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/liveness/liveness-policy";
import { trpc } from "@/lib/trpc/client";
import { getFirstPart } from "@/lib/utils/name-utils";
import { cn } from "@/lib/utils/utils";

import { useOnboardingStore } from "./onboarding-store";
import { useStepper } from "./stepper-context";
import { StepperControls } from "./stepper-ui";

type FaceMatchStatus = "idle" | "matching" | "matched" | "no_match" | "error";

type SecureStatus =
  | "idle"
  | "registering-passkey"
  | "unlocking-prf"
  | "generating-keys"
  | "encrypting-keys"
  | "uploading-keys"
  | "registering-keys"
  | "creating-account"
  | "finalizing-identity"
  | "generating-proofs"
  | "storing-proofs"
  | "complete"
  | "error";

interface OnboardingContextResponse {
  contextToken: string;
  registrationToken: string;
  expiresAt: string;
}

interface FheEnrollmentCompleteResponse {
  success: boolean;
  keyId: string;
}

function parseDateToInt(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) {
    return null;
  }
  const dateInt = Number(digits.slice(0, 8));
  return Number.isFinite(dateInt) ? dateInt : null;
}

async function ensureAuthSession() {
  const existing = await authClient.getSession();
  if (existing.data?.user?.id) {
    return existing.data;
  }

  const anonymous = await authClient.signIn.anonymous();
  if (anonymous?.error) {
    throw new Error(
      anonymous.error.message || "Unable to start anonymous session."
    );
  }

  const updated = await authClient.getSession();
  if (!updated.data?.user?.id) {
    throw new Error("Unable to start anonymous session.");
  }
  return updated.data;
}

async function requestOnboardingContext(
  email?: string | null
): Promise<OnboardingContextResponse> {
  const response = await fetch("/api/onboarding/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(email ? { email } : {}),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!(response.ok && payload) || typeof payload !== "object") {
    throw new Error("Unable to start onboarding.");
  }

  if ("error" in payload && payload.error) {
    throw new Error(String(payload.error));
  }

  return payload as OnboardingContextResponse;
}

async function completeFheEnrollment(enrollmentPayload: {
  registrationToken: string;
  wrappedDek: string;
  prfSalt: string;
  credentialId: string;
  keyId: string;
  version: string;
  kekVersion: string;
  envelopeFormat: "json" | "msgpack";
}): Promise<FheEnrollmentCompleteResponse> {
  const response = await fetch("/api/fhe/enrollment/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(enrollmentPayload),
  });

  const data = (await response.json().catch(() => null)) as unknown;
  if (!(response.ok && data) || typeof data !== "object") {
    throw new Error("Failed to finalize FHE enrollment.");
  }

  if ("error" in data && data.error) {
    throw new Error(String(data.error));
  }

  const responsePayload = data as FheEnrollmentCompleteResponse;
  if (!responsePayload.keyId) {
    throw new Error("Missing FHE key registration. Please try again.");
  }

  return responsePayload;
}

function buildProfilePayload(args: {
  extractedName: string | null;
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedNationality: string | null;
  extractedExpirationDate: string | null;
  extractedNationalityCode: string | null;
  documentType: string | null;
  documentOrigin: string | null;
  userSalt: string | null;
}): ProfileSecretPayload | null {
  const firstName = getFirstPart(args.extractedName) || null;
  const birthYear =
    parseBirthYearFromDob(args.extractedDOB ?? undefined) ?? null;
  const expiryDateInt = parseDateToInt(args.extractedExpirationDate);
  const nationalityCode = args.extractedNationalityCode || null;
  const fullName = args.extractedName || null;
  const dateOfBirth = args.extractedDOB || null;
  const documentNumber = args.extractedDocNumber || null;
  const nationality = args.extractedNationality || null;
  const documentType = args.documentType || null;
  const documentOrigin = args.documentOrigin || null;

  const hasAny =
    Boolean(fullName) ||
    Boolean(firstName) ||
    birthYear !== null ||
    expiryDateInt !== null ||
    Boolean(documentNumber) ||
    Boolean(nationality) ||
    Boolean(nationalityCode) ||
    Boolean(documentType) ||
    Boolean(documentOrigin) ||
    Boolean(args.userSalt);

  if (!hasAny) {
    return null;
  }

  return {
    fullName,
    firstName,
    birthYear,
    dateOfBirth,
    expiryDateInt,
    documentNumber,
    documentType,
    documentOrigin,
    nationality,
    nationalityCode,
    userSalt: args.userSalt ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function calculateAge(dob: string | null): number | null {
  if (!dob) {
    return null;
  }
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }
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
}

function StepIndicatorIcon({
  status,
  icon,
}: {
  status: "pending" | "active" | "complete";
  icon: React.ReactNode;
}) {
  if (status === "complete") {
    return <Check className="h-4 w-4" />;
  }
  if (status === "active") {
    return <Spinner />;
  }
  return icon;
}

function StepIndicator({
  label,
  status,
  icon,
}: {
  label: string;
  status: "pending" | "active" | "complete";
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full transition-all",
          status === "complete" && "bg-success text-success-foreground",
          status === "active" && "animate-pulse bg-info text-info-foreground",
          status === "pending" && "bg-muted text-muted-foreground"
        )}
      >
        <StepIndicatorIcon icon={icon} status={status} />
      </div>
      <span
        className={cn(
          "text-sm transition-colors",
          status === "complete" && "font-medium text-success",
          status === "active" && "font-medium text-info",
          status === "pending" && "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function StepAccount() {
  const router = useRouter();
  const stepper = useStepper();
  const store = useOnboardingStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Face matching state
  const [faceMatchStatus, setFaceMatchStatus] =
    useState<FaceMatchStatus>("idle");
  const [faceMatchResult, setFaceMatchResult] =
    useState<FaceMatchResult | null>(null);
  const faceMatchAttemptedRef = useRef(false);
  const noirIsolationWarningRef = useRef(false);

  // Passkey/secure keys state
  const [supportStatus, setSupportStatus] = useState<{
    supported: boolean;
    reason?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecureStatus>("idle");

  const hasIdentityDocs = Boolean(store.identityDraftId);
  const hasDob = Boolean(store.extractedDOB);
  const selfieForMatching = store.bestSelfieFrame || store.selfieImage;
  const hasIdentityImages = Boolean(
    store.idDocumentBase64 && selfieForMatching
  );

  const warnIfNoirIsolation = useCallback(() => {
    if (noirIsolationWarningRef.current) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    if (window.crossOriginIsolated) {
      return;
    }
    noirIsolationWarningRef.current = true;
    toast.warning("ZK proofs may be slower in this session", {
      description:
        "Your browser is not cross-origin isolated, so multi-threaded proving is disabled.",
    });
  }, []);

  // Check PRF support on mount
  useEffect(() => {
    let active = true;
    checkPrfSupport().then((result) => {
      if (active) {
        setSupportStatus(result);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Auto-trigger face matching when both ID and selfie are available
  useEffect(() => {
    if (faceMatchAttemptedRef.current) {
      return;
    }
    if (!(store.idDocumentBase64 && selfieForMatching)) {
      return;
    }
    if (faceMatchStatus !== "idle") {
      return;
    }

    faceMatchAttemptedRef.current = true;

    const performFaceMatch = async () => {
      if (!(store.idDocumentBase64 && selfieForMatching)) {
        return;
      }

      setFaceMatchStatus("matching");
      try {
        const result = await matchFaces(
          store.idDocumentBase64,
          selfieForMatching
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
  }, [store.idDocumentBase64, selfieForMatching, faceMatchStatus]);

  const progressStatus = useMemo(() => {
    const steps: SecureStatus[] = [
      "registering-passkey",
      "unlocking-prf",
      "generating-keys",
      "encrypting-keys",
      "uploading-keys",
      "registering-keys",
      "creating-account",
      "finalizing-identity",
      "generating-proofs",
      "storing-proofs",
      "complete",
    ];
    const currentIndex = steps.indexOf(status);
    const stepStatus = (
      index: number,
      active: SecureStatus | SecureStatus[]
    ): "pending" | "active" | "complete" => {
      const activeSteps = Array.isArray(active) ? active : [active];
      if (currentIndex > index) {
        return "complete";
      }
      if (activeSteps.includes(status)) {
        return "active";
      }
      return "pending";
    };
    return {
      passkey: stepStatus(0, "registering-passkey"),
      prf: stepStatus(1, "unlocking-prf"),
      secure: stepStatus(5, [
        "generating-keys",
        "encrypting-keys",
        "uploading-keys",
        "registering-keys",
      ]),
      account: stepStatus(6, "creating-account"),
      verify: stepStatus(7, "finalizing-identity"),
      proofs: stepStatus(8, "generating-proofs"),
      store: stepStatus(9, "storing-proofs"),
    };
  }, [status]);

  const statusMessage = useMemo(() => {
    switch (status) {
      case "registering-passkey":
        return "Creating your passkey…";
      case "unlocking-prf":
        return "Deriving encryption keys from your passkey…";
      case "generating-keys":
        return "Generating FHE keys locally…";
      case "encrypting-keys":
        return "Encrypting FHE keys on-device…";
      case "uploading-keys":
        return "Uploading encrypted keys…";
      case "registering-keys":
        return "Registering keys with the FHE service…";
      case "creating-account":
        return "Creating your account and storing secrets…";
      case "finalizing-identity":
        return "Finalizing your identity data…";
      case "generating-proofs":
        return "Generating privacy proofs…";
      case "storing-proofs":
        return "Storing proofs securely…";
      default:
        return null;
    }
  }, [status]);

  const handleCreateAccount = async () => {
    if (!supportStatus?.supported) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const documentResult = store.documentResult as {
        documentType?: string;
        documentOrigin?: string;
      } | null;

      const profilePayload = buildProfilePayload({
        extractedName: store.extractedName,
        extractedDOB: store.extractedDOB,
        extractedDocNumber: store.extractedDocNumber,
        extractedNationality: store.extractedNationality,
        extractedExpirationDate: store.extractedExpirationDate,
        extractedNationalityCode: store.extractedNationalityCode,
        documentType: documentResult?.documentType ?? null,
        documentOrigin: documentResult?.documentOrigin ?? null,
        userSalt: store.userSalt,
      });

      // Step 1: Ensure we have a session
      await ensureAuthSession();
      const prfSalt = generatePrfSalt();

      // Step 2: Create onboarding context
      const onboardingContext = await requestOnboardingContext(store.email);

      // Step 3: Register passkey with PRF extension
      setStatus("registering-passkey");
      const registration = await registerPasskeyWithPrf({
        name: "Primary Passkey",
        prfSalt,
        context: onboardingContext.contextToken,
      });

      let credentialId: string | null = null;
      let prfOutput: Uint8Array | null = null;

      if (!registration.ok && isPasskeyAlreadyRegistered(registration.error)) {
        setStatus("unlocking-prf");
        const authResult = await signInWithPasskey({ prfSalt });
        if (!authResult.ok) {
          const message =
            authResult.error?.code === "AUTH_CANCELLED"
              ? "Passkey sign-in was cancelled."
              : authResult.message ||
                "This passkey is already registered. Please sign in to continue.";
          throw new Error(message);
        }

        credentialId = authResult.credentialId ?? null;
        prfOutput = authResult.prfOutput ?? null;
      } else {
        if (!registration.ok) {
          throw new Error(registration.message);
        }
        credentialId = registration.credentialId;
        prfOutput = registration.prfOutput;
      }

      if (!credentialId) {
        throw new Error("Missing passkey credential ID.");
      }
      if (!prfOutput) {
        throw new Error(
          "This passkey did not return PRF output. Please try a different authenticator."
        );
      }

      cachePasskeyUnlock({ credentialId, prfOutput });

      // Step 4: Secure FHE keys locally
      const enrollment = { credentialId, prfOutput, prfSalt };
      const fheEnrollment = await prepareFheKeyEnrollment({
        enrollment,
        onStage: (stage) => {
          setStatus(
            stage === "generate-keys" ? "generating-keys" : "encrypting-keys"
          );
        },
      });

      setStatus("uploading-keys");
      await uploadSecretBlobWithToken({
        secretId: fheEnrollment.secretId,
        secretType: FHE_SECRET_TYPE,
        payload: fheEnrollment.encryptedBlob,
        registrationToken: onboardingContext.registrationToken,
      });

      setStatus("registering-keys");
      const fheRegistration = await registerFheKeyForEnrollment({
        registrationToken: onboardingContext.registrationToken,
        publicKeyBytes: fheEnrollment.publicKeyBytes,
        serverKeyBytes: fheEnrollment.serverKeyBytes,
      });

      // Step 5: Finalize enrollment
      setStatus("creating-account");
      const completion = await completeFheEnrollment({
        registrationToken: onboardingContext.registrationToken,
        wrappedDek: fheEnrollment.wrappedDek,
        prfSalt: fheEnrollment.prfSalt,
        credentialId,
        keyId: fheRegistration.keyId,
        version: PASSKEY_VAULT_VERSION,
        kekVersion: WRAP_VERSION,
        envelopeFormat: fheEnrollment.envelopeFormat,
      });

      if (profilePayload) {
        await storeProfileSecret({ profile: profilePayload, enrollment });
      }

      const fheKeyId = completion.keyId || fheRegistration.keyId;
      fheEnrollment.storedKeys.keyId = fheKeyId;
      cacheFheKeys(fheEnrollment.secretId, fheEnrollment.storedKeys);

      await trpc.onboarding.markKeysSecured.mutate();
      store.set({ keysSecured: true });

      // Step 6: Finalize identity and generate proofs if docs exist
      if (hasIdentityDocs) {
        if (!store.identityDraftId) {
          throw new Error(
            "Missing identity draft. Please restart verification."
          );
        }

        setStatus("finalizing-identity");
        const profileBirthYear =
          profilePayload?.birthYear ??
          parseBirthYearFromDob(store.extractedDOB ?? undefined) ??
          null;
        const birthYearOffset =
          calculateBirthYearOffsetFromYear(profileBirthYear);
        const profileNationalityCode =
          profilePayload?.nationalityCode ??
          store.extractedNationalityCode ??
          null;
        const countryCodeNumeric = profileNationalityCode
          ? countryCodeToNumeric(profileNationalityCode)
          : 0;

        const job = await trpc.identity.finalizeAsync.mutate({
          draftId: store.identityDraftId,
          fheKeyId,
          birthYearOffset: birthYearOffset ?? undefined,
          countryCodeNumeric:
            countryCodeNumeric > 0 ? countryCodeNumeric : undefined,
        });

        // Wait for finalization
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
                jobStatus.error || "Identity finalization failed."
              );
            }

            const delay = Math.min(1000 + attempt * 500, 4000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            attempt += 1;
          }

          throw new Error(
            "Finalization is taking longer than expected. Please try again shortly."
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
              "Identity verification did not pass. Please retake your ID photo and selfie and try again."
          );
        }

        if (identityResult.documentId) {
          store.set({ identityDocumentId: identityResult.documentId });
        }

        // Step 7: Generate proofs
        setStatus("generating-proofs");
        warnIfNoirIsolation();
        const activeDocumentId =
          identityResult.documentId ?? store.identityDocumentId;
        if (!activeDocumentId) {
          throw new Error(
            "Missing document context for proof generation. Please retry verification."
          );
        }

        const storeTasks: Promise<unknown>[] = [];
        const enqueueStore = (proof: {
          circuitType:
            | "age_verification"
            | "doc_validity"
            | "nationality_membership"
            | "face_match";
          proof: string;
          publicSignals: string[];
          generationTimeMs: number;
        }) => {
          storeTasks.push(
            storeProof({
              circuitType: proof.circuitType,
              proof: proof.proof,
              publicSignals: proof.publicSignals,
              generationTimeMs: proof.generationTimeMs,
              documentId: activeDocumentId,
            })
          );
        };

        try {
          const claims = await getSignedClaims(activeDocumentId);
          if (!(claims.ocr && claims.faceMatch)) {
            throw new Error("Signed claims unavailable for proof generation");
          }

          const ocrClaim = claims.ocr;
          const faceClaim = claims.faceMatch;
          const ocrData = ocrClaim.data as {
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
          const birthYear =
            profilePayload?.birthYear ??
            parseBirthYearFromDob(store.extractedDOB ?? undefined) ??
            null;
          const expiryDateInt =
            profilePayload?.expiryDateInt ??
            parseDateToInt(store.extractedExpirationDate);
          const nationalityCode =
            profilePayload?.nationalityCode ??
            store.extractedNationalityCode ??
            null;

          if (birthYear === null || birthYear === undefined || !ageClaimHash) {
            throw new Error("Missing birth year claim for age proof");
          }
          if (
            expiryDateInt === null ||
            expiryDateInt === undefined ||
            !docValidityClaimHash
          ) {
            throw new Error("Missing expiry date claim for document proof");
          }
          if (!(nationalityCode && nationalityClaimHash)) {
            throw new Error("Missing nationality claim for membership proof");
          }
          if (!faceData.claimHash) {
            throw new Error("Missing face match claim hash");
          }

          // Age proof
          const ageChallenge = await getProofChallenge("age_verification");
          const ageProof = await generateAgeProof(
            birthYear,
            new Date().getFullYear(),
            18,
            {
              nonce: ageChallenge.nonce,
              documentHashField,
              claimHash: ageClaimHash,
            }
          );
          enqueueStore({ circuitType: "age_verification", ...ageProof });

          // Doc validity proof
          const docChallenge = await getProofChallenge("doc_validity");
          const now = new Date();
          const currentDateInt =
            now.getFullYear() * 10_000 +
            (now.getMonth() + 1) * 100 +
            now.getDate();
          const docProof = await generateDocValidityProof(
            expiryDateInt,
            currentDateInt,
            {
              nonce: docChallenge.nonce,
              documentHashField,
              claimHash: docValidityClaimHash,
            }
          );
          enqueueStore({ circuitType: "doc_validity", ...docProof });

          // Nationality proof
          const nationalityChallenge = await getProofChallenge(
            "nationality_membership"
          );
          const nationalityProof = await generateNationalityProof(
            nationalityCode,
            NATIONALITY_GROUP,
            {
              nonce: nationalityChallenge.nonce,
              documentHashField,
              claimHash: nationalityClaimHash,
            }
          );
          enqueueStore({
            circuitType: "nationality_membership",
            ...nationalityProof,
          });

          // Face match proof
          const similarityFixed = ((): number | null => {
            if (typeof faceData.confidenceFixed === "number") {
              return faceData.confidenceFixed;
            }
            if (typeof faceData.confidence === "number") {
              return Math.round(faceData.confidence * 10_000);
            }
            return null;
          })();
          if (similarityFixed === null) {
            throw new Error("Missing face match confidence for proof");
          }

          const thresholdFixed =
            typeof faceData.thresholdFixed === "number"
              ? faceData.thresholdFixed
              : Math.round(FACE_MATCH_MIN_CONFIDENCE * 10_000);
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
            }
          );
          enqueueStore({ circuitType: "face_match", ...faceProof });
        } catch (zkError) {
          const errorMessage =
            zkError instanceof Error ? zkError.message : "Unknown error";
          const isTimeout = errorMessage.includes("timed out");
          const isWasmError =
            errorMessage.toLowerCase().includes("wasm") ||
            errorMessage.toLowerCase().includes("module");

          let friendlyMessage =
            "Privacy verification services are temporarily unavailable. Please try again in a few minutes.";
          if (isTimeout) {
            friendlyMessage =
              "Privacy verification is taking too long. This may be due to network issues loading cryptographic libraries. Please refresh the page and try again.";
          } else if (isWasmError) {
            friendlyMessage =
              "Unable to load cryptographic libraries. Please try refreshing the page. If using a VPN or content blocker, it may be blocking required resources.";
          }

          throw new Error(friendlyMessage);
        }

        // Step 8: Store proofs
        setStatus("storing-proofs");
        await Promise.all(storeTasks);
      }

      // Complete!
      setStatus("complete");
      setIsRedirecting(true);

      // Clear session and redirect
      try {
        await trpc.onboarding.clearSession.mutate();
      } catch {
        // Ignore clear errors during redirect
      }
      store.reset();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account.";
      setError(message);
      setStatus("error");
      toast.error("Account creation failed", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const unsupportedMessage =
    supportStatus && !supportStatus.supported
      ? supportStatus.reason ||
        "PRF passkeys are not supported on this device or browser."
      : null;

  if (isRedirecting) {
    return (
      <div className="rounded-lg border p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          <span>Finalizing your account…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-medium text-lg">Create Your Account</h3>
        <p className="text-muted-foreground text-sm">
          Review your information, then create your account with a passkey.
          Passkeys are more secure than passwords and work across all your
          devices.
        </p>
        {!supportStatus && (
          <p className="text-muted-foreground text-xs">
            Checking passkey support…
          </p>
        )}
      </div>

      {!!unsupportedMessage && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            {unsupportedMessage}
            <div className="mt-2 text-muted-foreground text-xs">
              Supported: Chrome/Edge/Firefox with a PRF-capable passkey. Safari
              requires iCloud Keychain. Windows Hello and external keys on
              iOS/iPadOS are not supported.
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!!error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Extracted Information Review - only show when idle */}
      {status === "idle" && (
        <div className="rounded-lg border p-4">
          <h4 className="mb-4 font-medium text-muted-foreground text-sm uppercase tracking-wide">
            Your Information
          </h4>

          <ItemGroup>
            <Item size="sm">
              <ItemContent>
                <ItemDescription>Email</ItemDescription>
                <ItemTitle>{store.email || "Not provided"}</ItemTitle>
              </ItemContent>
            </Item>

            <ItemSeparator />

            <Item size="sm">
              <ItemContent>
                <ItemDescription>Name</ItemDescription>
                <ItemTitle>{store.extractedName || "Not extracted"}</ItemTitle>
              </ItemContent>
            </Item>

            <ItemSeparator />

            <Item size="sm">
              <ItemContent>
                <ItemDescription>Date of Birth</ItemDescription>
                <ItemTitle>{store.extractedDOB || "Not extracted"}</ItemTitle>
              </ItemContent>
              {calculateAge(store.extractedDOB) !== null && (
                <ItemActions>
                  <Badge variant="secondary">
                    {calculateAge(store.extractedDOB)}+ years
                  </Badge>
                </ItemActions>
              )}
            </Item>

            <ItemSeparator />

            <Item size="sm">
              <ItemContent>
                <ItemDescription>Nationality</ItemDescription>
                <ItemTitle>
                  {store.extractedNationality || "Not extracted"}
                </ItemTitle>
              </ItemContent>
            </Item>

            <ItemSeparator />

            <Item size="sm">
              <ItemContent>
                <ItemDescription>Document</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={store.idDocument ? "default" : "outline"}>
                  {store.idDocument ? "Uploaded" : "Skipped"}
                </Badge>
              </ItemActions>
            </Item>

            <ItemSeparator />

            <Item size="sm">
              <ItemContent>
                <ItemDescription>Liveness</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={store.selfieImage ? "default" : "outline"}>
                  {store.selfieImage ? "Verified" : "Skipped"}
                </Badge>
              </ItemActions>
            </Item>
          </ItemGroup>
        </div>
      )}

      {/* Face Matching UI - only show when idle and has docs */}
      {status === "idle" && hasIdentityImages && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Face Verification</span>
          </div>

          <div className="flex items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "relative h-20 w-20 overflow-hidden rounded-lg border bg-muted",
                  faceMatchStatus === "matching" &&
                    "ring-2 ring-info/40 ring-offset-2"
                )}
              >
                {faceMatchStatus === "matching" &&
                  !faceMatchResult?.idFaceImage && (
                    <Skeleton className="h-full w-full" />
                  )}
                {!!faceMatchResult?.idFaceImage && (
                  <img
                    alt="Face extracted from your ID (preview)"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      faceMatchStatus === "matching" && "opacity-70"
                    )}
                    height={80}
                    src={faceMatchResult.idFaceImage}
                    width={80}
                  />
                )}
                {!faceMatchResult?.idFaceImage &&
                  faceMatchStatus !== "matching" && (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
                      ID face
                    </div>
                  )}
              </div>
              <span className="text-muted-foreground text-xs">ID Photo</span>
            </div>

            <div className="flex flex-col items-center gap-1">
              {faceMatchStatus === "idle" && (
                <ArrowLeftRight className="h-6 w-6 text-muted-foreground" />
              )}
              {faceMatchStatus === "matching" && (
                <div className="fade-in flex animate-in flex-col items-center gap-1 duration-300">
                  <div className="relative">
                    <Spinner className="size-6 text-info" />
                    <div className="absolute inset-0 h-6 w-6 animate-ping rounded-full bg-info/20" />
                  </div>
                  <Skeleton className="mt-1 h-3 w-16" />
                </div>
              )}
              {faceMatchStatus === "matched" && (
                <div className="zoom-in animate-in duration-300">
                  <Check className="h-6 w-6 text-success" />
                  <span className="font-medium text-success text-xs">
                    {Math.round((faceMatchResult?.confidence || 0) * 100)}%
                    match
                  </span>
                </div>
              )}
              {faceMatchStatus === "no_match" && (
                <>
                  <XCircle className="h-6 w-6 text-destructive" />
                  <span className="font-medium text-destructive text-xs">
                    No match
                  </span>
                </>
              )}
              {faceMatchStatus === "error" && (
                <>
                  <XCircle className="h-6 w-6 text-warning" />
                  <span className="font-medium text-warning text-xs">
                    Error
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "relative h-20 w-20 overflow-hidden rounded-lg border bg-muted",
                  faceMatchStatus === "matching" &&
                    "ring-2 ring-info/40 ring-offset-2"
                )}
              >
                {faceMatchStatus === "matching" && !selfieForMatching && (
                  <Skeleton className="h-full w-full" />
                )}
                {!!selfieForMatching && (
                  <img
                    alt="Selfie"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      faceMatchStatus === "matching" && "opacity-70"
                    )}
                    height={80}
                    src={selfieForMatching}
                    width={80}
                  />
                )}
              </div>
              <span className="text-muted-foreground text-xs">Selfie</span>
            </div>
          </div>

          {faceMatchStatus === "matching" && (
            <p className="text-center text-muted-foreground text-sm">
              Comparing faces…
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
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Passkey-protected account</span>
            <Badge variant="secondary">Recommended</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Your account is protected by a passkey instead of a password.
            Passkeys are phishing-resistant and work with your device's
            biometrics (Face ID, Touch ID, Windows Hello). You can optionally
            add a recovery password later in settings.
          </p>
        </div>
      )}

      {/* Progress UI - show when creating account */}
      {status !== "idle" && status !== "error" && (
        <div className="fade-in animate-in space-y-4 rounded-lg border border-info/30 bg-info/10 p-5 text-info duration-300">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-medium">Creating your secure account</span>
          </div>
          {!!statusMessage && (
            <p className="text-info/80 text-sm">{statusMessage}</p>
          )}

          <div className="space-y-3">
            <StepIndicator
              icon={<KeyRound className="h-4 w-4" />}
              label="Create passkey"
              status={progressStatus.passkey}
            />
            <StepIndicator
              icon={<Spinner />}
              label="Derive encryption key"
              status={progressStatus.prf}
            />
            <StepIndicator
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Secure FHE keys"
              status={progressStatus.secure}
            />
            <StepIndicator
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Create account & store keys"
              status={progressStatus.account}
            />
            {!!hasIdentityDocs && (
              <>
                <StepIndicator
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Finalize identity"
                  status={progressStatus.verify}
                />
                <StepIndicator
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Generate privacy proofs"
                  status={progressStatus.proofs}
                />
                <StepIndicator
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Store proofs"
                  status={progressStatus.store}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Privacy Info - only show when idle */}
      {!isSubmitting && status === "idle" && (
        <Alert>
          <AlertDescription>
            <strong>Privacy-First Verification:</strong>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {!!hasDob && (
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
              {!!hasIdentityImages && (
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
                Only commitments, proofs, signed claims, encrypted attributes,
                and a passkey-sealed profile are stored - no plaintext PII is
                retained
              </li>
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Only show controls when idle and not submitting */}
      {status === "idle" && !isSubmitting && (
        <StepperControls
          disableNext={!supportStatus?.supported}
          isSubmitting={isSubmitting}
          nextLabel="Create Account with Passkey"
          onNext={handleCreateAccount}
          stepper={stepper}
        />
      )}
    </div>
  );
}
