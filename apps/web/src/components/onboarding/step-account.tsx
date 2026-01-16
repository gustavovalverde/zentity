"use client";

import { KeyRound, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useFaceMatch } from "@/hooks/onboarding/use-face-match";
import {
  ensureAuthSession,
  useOnboardingSession,
} from "@/hooks/onboarding/use-onboarding-session";
import {
  isPasskeyAlreadyRegistered,
  registerPasskeyWithPrf,
  signInWithPasskey,
} from "@/lib/auth/passkey";
import { fetchMsgpack } from "@/lib/crypto/binary-transport";
import {
  generateFheKeyMaterialForStorage,
  prepareFheKeyEnrollment,
  registerFheKeyForEnrollment,
} from "@/lib/crypto/crypto-client";
import {
  cacheFheKeys,
  FHE_SECRET_TYPE,
  storeFheKeysWithCredential,
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
import {
  cachePasskeyUnlock,
  type EnrollmentCredential,
} from "@/lib/crypto/secret-vault";
import { checkPrfSupport } from "@/lib/crypto/webauthn-prf";
import { parseBirthYearFromDob } from "@/lib/identity/birth-year";
import { parseDateToInt } from "@/lib/identity/date-utils";
import { finalizeIdentityAndGenerateProofs } from "@/lib/identity/finalize-and-prove";
import { trpc } from "@/lib/trpc/client";
import { getFirstPart } from "@/lib/utils/name-utils";

import { CredentialChoice, type CredentialType } from "./credential-choice";
import { ExtractedInfoReview } from "./extracted-info-review";
import { FaceVerificationCard } from "./face-verification-card";
import { useOnboardingStore } from "./onboarding-store";
import { PasswordSignUpForm } from "./password-signup-form";
import {
  type SecureStatus,
  VerificationProgress,
} from "./verification-progress";

interface OnboardingContextResponse {
  contextToken: string;
  registrationToken: string;
  expiresAt: string;
}

interface FheEnrollmentCompleteResponse {
  success: boolean;
  keyId: string;
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

export function StepAccount() {
  const router = useRouter();
  const store = useOnboardingStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const noirIsolationWarningRef = useRef(false);

  // Credential choice state
  const [credentialType, setCredentialType] = useState<CredentialType | null>(
    null
  );

  // Passkey/secure keys state
  const [supportStatus, setSupportStatus] = useState<{
    supported: boolean;
    reason?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecureStatus>("idle");

  // Session state from extracted hook
  const {
    email: sessionEmail,
    userId: sessionUserId,
    isAnonymous: isAnonymousSession,
    isReady: sessionReady,
    error: sessionError,
  } = useOnboardingSession();

  const hasIdentityDocs = Boolean(store.identityDraftId);
  const hasDob = Boolean(store.extractedDOB);
  const selfieForMatching = store.bestSelfieFrame || store.selfieImage;
  const hasIdentityImages = Boolean(
    store.idDocumentBase64 && selfieForMatching
  );

  // Face matching from extracted hook (auto-triggers when both images available)
  const { status: faceMatchStatus, result: faceMatchResult } = useFaceMatch(
    store.idDocumentBase64,
    selfieForMatching
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

  // Set error from session if present
  useEffect(() => {
    if (sessionError) {
      setError(sessionError);
    }
  }, [sessionError]);

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

        await finalizeIdentityAndGenerateProofs({
          draftId: store.identityDraftId,
          fheKeyId,
          profilePayload,
          extractedDOB: store.extractedDOB,
          extractedExpirationDate: store.extractedExpirationDate,
          extractedNationalityCode: store.extractedNationalityCode,
          onStatus: setStatus,
          onWarnIsolation: warnIfNoirIsolation,
          onDocumentId: (docId) => store.set({ identityDocumentId: docId }),
        });
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

  /**
   * Handle password-based sign-up using OPAQUE.
   * This mirrors the passkey flow but uses OPAQUE export key for FHE key wrapping.
   */
  const handlePasswordSignUp = async (result: {
    userId: string;
    email: string;
    exportKey: Uint8Array;
  }) => {
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

      // Create enrollment credential for OPAQUE
      const credential: EnrollmentCredential = {
        type: "opaque",
        context: {
          userId: result.userId,
          exportKey: result.exportKey,
        },
      };

      // Step 1: Generate FHE keys
      setStatus("generating-keys");
      const { storedKeys: generatedKeys } =
        await generateFheKeyMaterialForStorage();

      // Step 2: Store FHE keys using OPAQUE-wrapped DEK
      setStatus("encrypting-keys");
      const storedKeys = { ...generatedKeys };

      setStatus("uploading-keys");
      const { secretId } = await storeFheKeysWithCredential({
        keys: storedKeys,
        credential,
      });

      // Step 3: Register keys with FHE service (session-based auth)
      setStatus("registering-keys");
      const fheRegistration = await fetchMsgpack<{ keyId: string }>(
        "/api/fhe/keys/register",
        {
          publicKey: generatedKeys.publicKey,
          serverKey: generatedKeys.serverKey,
        },
        { credentials: "include" }
      );

      // Cache the keys
      storedKeys.keyId = fheRegistration.keyId;
      cacheFheKeys(secretId, storedKeys);

      setStatus("creating-account");
      await trpc.onboarding.markKeysSecured.mutate();
      store.set({ keysSecured: true });

      // Step 4: Store profile secret if available
      if (profilePayload) {
        const { storeProfileSecretWithCredential } = await import(
          "@/lib/crypto/profile-secret"
        );
        await storeProfileSecretWithCredential({
          profile: profilePayload,
          credential,
        });
      }

      // Step 5: Finalize identity and generate proofs if docs exist
      if (hasIdentityDocs) {
        if (!store.identityDraftId) {
          throw new Error(
            "Missing identity draft. Please restart verification."
          );
        }

        await finalizeIdentityAndGenerateProofs({
          draftId: store.identityDraftId,
          fheKeyId: storedKeys.keyId ?? "",
          profilePayload,
          extractedDOB: store.extractedDOB,
          extractedExpirationDate: store.extractedExpirationDate,
          extractedNationalityCode: store.extractedNationalityCode,
          onStatus: setStatus,
          onWarnIsolation: warnIfNoirIsolation,
          onDocumentId: (docId) => store.set({ identityDocumentId: docId }),
        });
      }

      // Complete!
      setStatus("complete");
      setIsRedirecting(true);

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
        <ExtractedInfoReview
          email={store.email || ""}
          extractedDOB={store.extractedDOB}
          extractedName={store.extractedName}
          extractedNationality={store.extractedNationality}
          hasIdDocument={!!store.idDocument}
          hasSelfie={!!store.selfieImage}
        />
      )}

      {/* Face Matching UI - only show when idle and has docs */}
      {status === "idle" && hasIdentityImages && (
        <FaceVerificationCard
          result={faceMatchResult}
          selfieImage={selfieForMatching}
          status={faceMatchStatus}
        />
      )}

      {/* Loading indicator while session is being established */}
      {!sessionReady && status === "idle" && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Spinner />
          <span>Initializing session...</span>
        </div>
      )}

      {/* Credential Choice - show when status is idle and no credential type selected */}
      {status === "idle" &&
        credentialType === null &&
        !isSubmitting &&
        sessionReady && (
          <CredentialChoice
            disabled={isSubmitting}
            onSelect={(type) => setCredentialType(type)}
            prfSupported={supportStatus?.supported ?? false}
          />
        )}

      {/* Password Sign-Up Form - show when password credential type selected */}
      {status === "idle" && credentialType === "password" && !isSubmitting && (
        <PasswordSignUpForm
          disabled={isSubmitting || !sessionReady}
          email={store.email || sessionEmail || ""}
          isAnonymous={isAnonymousSession}
          onBack={() => setCredentialType(null)}
          onSuccess={handlePasswordSignUp}
          userId={sessionUserId || undefined}
        />
      )}

      {/* Passkey Info Card - only show when passkey credential type is selected */}
      {status === "idle" && credentialType === "passkey" && (
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
        <VerificationProgress
          hasIdentityDocs={hasIdentityDocs}
          status={status}
        />
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

      {/* Only show passkey controls when passkey credential type is selected */}
      {status === "idle" && credentialType === "passkey" && !isSubmitting && (
        <div className="flex gap-3">
          <Button
            onClick={() => setCredentialType(null)}
            type="button"
            variant="outline"
          >
            Back
          </Button>
          <Button
            className="flex-1"
            disabled={!supportStatus?.supported}
            onClick={handleCreateAccount}
            type="button"
          >
            Create Account with Passkey
          </Button>
        </div>
      )}
    </div>
  );
}
