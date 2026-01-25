"use client";

import type { EnrollmentCredential } from "@/lib/privacy/secrets";

import { ChevronDown, KeyRound, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import {
  ensureAuthSession,
  useSignUpSession,
} from "@/hooks/sign-up/use-sign-up-session";
import { useCrossOriginIsolated } from "@/hooks/use-cross-origin-isolated";
import {
  isPasskeyAlreadyRegistered,
  registerPasskeyWithPrf,
  signInWithPasskey,
} from "@/lib/auth/passkey";
import { checkPrfSupport } from "@/lib/auth/webauthn-prf";
import { storeBbsCredential } from "@/lib/bbs/client-storage";
import { deserializeCredential } from "@/lib/bbs/serialization";
import {
  cachePasskeyUnlock,
  computeWalletCommitment,
  generatePrfSalt,
  generateWalletCommitmentSalt,
  walletCommitmentToHex,
} from "@/lib/privacy/credentials";
import {
  generateFheKeyMaterialForStorage,
  prepareFheKeyEnrollment,
  registerFheKeyForEnrollment,
} from "@/lib/privacy/fhe/client";
import {
  cacheFheKeys,
  storeFheKeysWithCredential,
  uploadSecretBlobWithToken,
} from "@/lib/privacy/fhe/store";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
import { fetchMsgpack } from "@/lib/privacy/utils/binary-transport";
import { trpc } from "@/lib/trpc/client";
import { useSignUpStore } from "@/store/sign-up";

import {
  type SecureStatus,
  VerificationProgress,
} from "./account-setup-progress";
import { CredentialChoice, type CredentialType } from "./credential-choice";
import { PasswordSignUpForm } from "./password-signup-form";
import { WalletSignUpForm } from "./wallet-signup-form";

export function StepAccount() {
  const router = useRouter();
  const signUpStore = useSignUpStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

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
  } = useSignUpSession();

  // Detect cross-origin isolation for threading support
  const { hasThreadSupport, isLoading: threadCheckLoading } =
    useCrossOriginIsolated();

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
      // Step 1: Ensure we have a session (this creates the anonymous user)
      setStatus("preparing-account");
      const session = await ensureAuthSession();
      const userId = session.user.id;
      const prfSalt = generatePrfSalt();

      // Step 2: Create enrollment context via tRPC
      const enrollmentContext = await trpc.signUp.createContext.mutate(
        signUpStore.email ? { email: signUpStore.email } : undefined
      );

      // Step 3: Register passkey with PRF extension
      setStatus("registering-passkey");
      const registration = await registerPasskeyWithPrf({
        name: "Primary Passkey",
        prfSalt,
        context: enrollmentContext.contextToken,
      });

      let credentialId: string | null = null;
      let prfOutput: Uint8Array | null = null;

      if (!registration.ok && isPasskeyAlreadyRegistered(registration.error)) {
        setStatus("unlocking-prf");
        // Use allowPrfFallback: false to avoid a third WebAuthn prompt
        // if PRF output isn't in the sign-in response directly
        const authResult = await signInWithPasskey({
          prfSalt,
          allowPrfFallback: false,
        });
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
      const enrollment = { credentialId, userId, prfOutput, prfSalt };
      const fheEnrollment = await prepareFheKeyEnrollment({
        enrollment,
        onStage: (stage) => {
          setStatus(
            stage === "generate-keys" ? "generating-keys" : "encrypting-keys"
          );
        },
      });

      setStatus("uploading-keys");
      const [, fheRegistration] = await Promise.all([
        uploadSecretBlobWithToken({
          secretId: fheEnrollment.secretId,
          secretType: SECRET_TYPES.FHE_KEYS,
          payload: fheEnrollment.encryptedBlob,
          registrationToken: enrollmentContext.registrationToken,
        }),
        registerFheKeyForEnrollment({
          registrationToken: enrollmentContext.registrationToken,
          publicKeyBytes: fheEnrollment.publicKeyBytes,
          serverKeyBytes: fheEnrollment.serverKeyBytes,
        }),
      ]);

      // Step 5: Finalize enrollment via tRPC (store encrypted secrets)
      setStatus("storing-secrets");
      const completion = await trpc.signUp.completeFheEnrollment.mutate({
        registrationToken: enrollmentContext.registrationToken,
        wrappedDek: fheEnrollment.wrappedDek,
        prfSalt: fheEnrollment.prfSalt,
        credentialId,
        keyId: fheRegistration.keyId,
        envelopeFormat: fheEnrollment.envelopeFormat,
      });

      const fheKeyId = completion.keyId || fheRegistration.keyId;
      fheEnrollment.storedKeys.keyId = fheKeyId;
      cacheFheKeys(fheEnrollment.secretId, fheEnrollment.storedKeys);

      await trpc.signUp.markKeysSecured.mutate();

      // Complete!
      setStatus("complete");
      setIsRedirecting(true);

      // Clear session and redirect
      try {
        await trpc.signUp.clearSession.mutate();
      } catch {
        // Ignore clear errors during redirect
      }
      signUpStore.reset();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account.";
      setError(message);
      setStatus("error");
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

      // Step 2: Store FHE keys + register with FHE service in parallel
      setStatus("uploading-keys");
      const storedKeys = { ...generatedKeys };

      const [{ secretId }, fheRegistration] = await Promise.all([
        storeFheKeysWithCredential({
          keys: storedKeys,
          credential,
        }),
        fetchMsgpack<{ keyId: string }>(
          "/api/fhe/keys/register",
          {
            publicKey: generatedKeys.publicKey,
            serverKey: generatedKeys.serverKey,
          },
          { credentials: "include" }
        ),
      ]);

      // Cache the keys
      storedKeys.keyId = fheRegistration.keyId;
      cacheFheKeys(secretId, storedKeys);

      setStatus("storing-secrets");
      // Create identity bundle for OPAQUE users (establishes Tier 1)
      await trpc.signUp.completeOpaqueEnrollment.mutate({
        fheKeyId: fheRegistration.keyId,
        email: signUpStore.email || undefined,
      });
      await trpc.signUp.markKeysSecured.mutate();

      // Complete!
      setStatus("complete");
      setIsRedirecting(true);

      try {
        await trpc.signUp.clearSession.mutate();
      } catch {
        // Ignore clear errors during redirect
      }
      signUpStore.reset();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account.";
      setError(message);
      setStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handle wallet-based sign-up.
   * Uses EIP-712 signature to derive KEK for FHE key wrapping.
   */
  const handleWalletSignUp = async (result: {
    userId: string;
    address: string;
    chainId: number;
    signatureBytes: Uint8Array;
    signedAt: number;
    expiresAt: number;
  }) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const credential: EnrollmentCredential = {
        type: "wallet",
        context: {
          userId: result.userId,
          address: result.address,
          chainId: result.chainId,
          signatureBytes: result.signatureBytes,
          signedAt: result.signedAt,
          expiresAt: result.expiresAt,
        },
      };

      setStatus("generating-keys");
      const { storedKeys: generatedKeys } =
        await generateFheKeyMaterialForStorage();

      setStatus("uploading-keys");
      const storedKeys = { ...generatedKeys };

      const [{ secretId }, fheRegistration] = await Promise.all([
        storeFheKeysWithCredential({
          keys: storedKeys,
          credential,
        }),
        fetchMsgpack<{ keyId: string }>(
          "/api/fhe/keys/register",
          {
            publicKey: generatedKeys.publicKey,
            serverKey: generatedKeys.serverKey,
          },
          { credentials: "include" }
        ),
      ]);

      storedKeys.keyId = fheRegistration.keyId;
      cacheFheKeys(secretId, storedKeys);

      // Issue BBS+ wallet credential for identity binding
      const commitmentSalt = generateWalletCommitmentSalt();
      const commitment = await computeWalletCommitment(
        result.address,
        commitmentSalt
      );
      const walletCommitment = `0x${walletCommitmentToHex(commitment)}`;

      const bbsResult = await trpc.crypto.bbs.issueWalletCredential.mutate({
        walletCommitment,
        network: "ethereum",
        chainId: result.chainId,
        tier: 1,
      });

      // Store credential with salt in IndexedDB
      await storeBbsCredential(
        result.userId,
        deserializeCredential(bbsResult.credential),
        { commitmentSalt }
      );

      setStatus("storing-secrets");
      await trpc.signUp.completeWalletEnrollment.mutate({
        fheKeyId: fheRegistration.keyId,
        address: result.address,
        chainId: result.chainId,
        email: signUpStore.email || undefined,
      });
      await trpc.signUp.markKeysSecured.mutate();

      setStatus("complete");
      setIsRedirecting(true);

      try {
        await trpc.signUp.clearSession.mutate();
      } catch {
        // Ignore clear errors during redirect
      }
      signUpStore.reset();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account.";
      setError(message);
      setStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const unsupportedMessage =
    supportStatus && !supportStatus.supported
      ? supportStatus.reason ||
        "Passkeys with encryption support are not available on this device or browser."
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
        <h3 className="font-medium text-lg">Create your account</h3>
        <p className="text-muted-foreground text-sm">
          Choose how you'd like to secure your encryption keys.
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
              Supported: Chrome, Edge, or Firefox with device biometrics. Safari
              requires iCloud Keychain. Windows Hello and external keys on
              iOS/iPadOS are not supported.
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!!error && (
        <Alert variant="destructive">
          <AlertDescription>
            <div className="space-y-3">
              <p>{error}</p>
              <p className="text-muted-foreground text-xs">
                You can safely try again. Your previous incomplete signup will
                be automatically cleaned up.
              </p>
              <Button
                onClick={() => {
                  setError(null);
                  setStatus("idle");
                  setCredentialType(null);
                }}
                size="sm"
                variant="outline"
              >
                Try Again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Threading warning when SharedArrayBuffer is unavailable */}
      {!(threadCheckLoading || hasThreadSupport) && status === "idle" && (
        <Alert variant="warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Slower key generation</p>
            <p className="text-xs">
              Your browser's security settings prevent multi-threaded
              processing. Key generation will take longer than usual.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading indicator while session is being established */}
      {!sessionReady && status === "idle" ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Spinner />
          <span>Initializing session...</span>
        </div>
      ) : null}

      {/* Credential Choice - show when status is idle and no credential type selected */}
      {status === "idle" &&
      credentialType === null &&
      !isSubmitting &&
      sessionReady ? (
        <CredentialChoice
          disabled={isSubmitting}
          onSelect={(type) => setCredentialType(type)}
          prfSupported={supportStatus?.supported ?? false}
        />
      ) : null}

      {/* Password Sign-Up Form - show when password credential type selected */}
      {status === "idle" && credentialType === "password" && !isSubmitting ? (
        <PasswordSignUpForm
          disabled={isSubmitting || !sessionReady}
          email={signUpStore.email || sessionEmail || ""}
          isAnonymous={isAnonymousSession}
          onBack={() => setCredentialType(null)}
          onSuccess={handlePasswordSignUp}
          userId={sessionUserId || undefined}
        />
      ) : null}

      {/* Wallet Sign-Up Form - show when wallet credential type selected */}
      {status === "idle" &&
      credentialType === "wallet" &&
      !isSubmitting &&
      sessionUserId ? (
        <WalletSignUpForm
          disabled={isSubmitting || !sessionReady}
          onBack={() => setCredentialType(null)}
          onSuccess={handleWalletSignUp}
          userId={sessionUserId}
        />
      ) : null}

      {/* Passkey Info Card - only show when passkey credential type is selected */}
      {status === "idle" && credentialType === "passkey" ? (
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
      ) : null}

      {/* Progress UI - show when creating account */}
      {status !== "idle" && status !== "error" ? (
        <VerificationProgress
          credentialType={credentialType}
          hasThreadSupport={hasThreadSupport}
          status={status}
        />
      ) : null}

      {/* Privacy Info - collapsible for reduced cognitive load */}
      {!isSubmitting && status === "idle" ? (
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border p-4 text-left text-sm hover:bg-accent/50">
            <span className="text-muted-foreground">
              Your data is encrypted end-to-end. No plaintext PII is stored.
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <div className="space-y-2 px-4 pt-3 text-muted-foreground text-xs">
              <p>
                Your encryption keys are generated locally. Only encrypted keys
                and cryptographic commitments are stored.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/* Only show passkey controls when passkey credential type is selected */}
      {status === "idle" && credentialType === "passkey" && !isSubmitting ? (
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
      ) : null}
    </div>
  );
}
