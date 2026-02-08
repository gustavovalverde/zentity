"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import {
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { listUserPasskeys, signInWithPasskey } from "@/lib/auth/passkey";
import { checkPrfSupport } from "@/lib/auth/webauthn-prf";
import {
  buildKekSignatureTypedData,
  generatePrfSalt,
  signatureToBytes,
} from "@/lib/privacy/credentials";
import {
  generateFheKeyMaterialForStorage,
  prepareFheKeyEnrollment,
  registerFheKeyForEnrollment,
} from "@/lib/privacy/fhe/client";
import { prewarmTfheWorker } from "@/lib/privacy/fhe/keygen-client";
import {
  getStoredFheKeys,
  persistFheKeyId,
  storeFheKeysWithCredential,
} from "@/lib/privacy/fhe/store";
import { uploadSecretBlob } from "@/lib/privacy/secrets/storage";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
import { trpc } from "@/lib/trpc/client";

type EnrollmentMethod = "passkey" | "wallet" | "password" | "create-password";
type EnrollmentStage =
  | "idle"
  | "checking"
  | "unlocking"
  | "generating"
  | "encrypting"
  | "uploading"
  | "registering"
  | "finalizing"
  | "done";

const STAGE_LABELS: Record<EnrollmentStage, string> = {
  idle: "",
  checking: "Checking existing keys...",
  unlocking: "Unlocking your credential...",
  generating: "Generating encryption keys...",
  encrypting: "Encrypting keys on-device...",
  uploading: "Uploading encrypted keys...",
  registering: "Registering with FHE service...",
  finalizing: "Finalizing enrollment...",
  done: "Ready!",
};

const KEK_SIGNATURE_VALIDITY_DAYS = 365;

interface FheEnrollmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPasskeys: boolean;
  hasPassword: boolean;
  wallet: { address: string; chainId: number } | null;
}

function WalletEnrollmentButton({
  wallet,
  stage,
  onEnroll,
}: Readonly<{
  wallet: { address: string; chainId: number };
  stage: EnrollmentStage;
  onEnroll: (method: "wallet", walletContext: WalletContext) => void;
}>) {
  const { open: openWalletModal } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const chainId = useChainId();
  const { mutateAsync: signTypedData } = useSignTypedData();

  const isRunning = stage !== "idle" && stage !== "done";

  const handleClick = useCallback(() => {
    if (isRunning) {
      return;
    }

    if (!(isConnected && address)) {
      openWalletModal().catch(() => undefined);
      return;
    }

    if (address.toLowerCase() !== wallet.address.toLowerCase()) {
      toast.error(
        `Connect wallet ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      );
      openWalletModal().catch(() => undefined);
      return;
    }

    if (chainId && chainId !== wallet.chainId) {
      toast.error("Switch to the linked wallet network");
      return;
    }

    onEnroll("wallet", {
      signTypedData,
      address: wallet.address,
      chainId: wallet.chainId,
    });
  }, [
    isRunning,
    isConnected,
    address,
    wallet,
    chainId,
    openWalletModal,
    signTypedData,
    onEnroll,
  ]);

  return (
    <Button
      className="w-full justify-start gap-3"
      disabled={isRunning}
      onClick={handleClick}
      variant="outline"
    >
      <Wallet className="h-4 w-4" />
      <span>
        {isConnected && address
          ? `Wallet (${address.slice(0, 6)}...${address.slice(-4)})`
          : "Connect Wallet"}
      </span>
    </Button>
  );
}

interface WalletContext {
  signTypedData: (args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<string>;
  address: string;
  chainId: number;
}

export function FheEnrollmentDialog({
  open,
  onOpenChange,
  hasPasskeys,
  hasPassword,
  wallet,
}: Readonly<FheEnrollmentDialogProps>) {
  const router = useRouter();
  const [stage, setStage] = useState<EnrollmentStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (open) {
      prewarmTfheWorker();
      checkPrfSupport().then((r) => setPrfSupported(r.supported));
    }
  }, [open]);

  const availableMethods = useMemo(() => {
    const methods: EnrollmentMethod[] = [];
    if (hasPasskeys && prfSupported !== false) {
      methods.push("passkey");
    }
    if (wallet) {
      methods.push("wallet");
    }
    if (hasPassword) {
      methods.push("password");
    }
    return methods;
  }, [hasPasskeys, hasPassword, prfSupported, wallet]);

  const updateIdentityStatus = useCallback(async (keyId: string) => {
    const response = await fetch("/api/identity/fhe-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fheKeyId: keyId, fheStatus: "complete" }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error || "Failed to update enrollment status.");
    }
  }, []);

  const checkExistingEnrollment = useCallback(async (): Promise<boolean> => {
    const bundle = await trpc.secrets.getSecretBundle.query({
      secretType: SECRET_TYPES.FHE_KEYS,
    });

    const existingKeyId =
      bundle?.secret?.metadata &&
      typeof bundle.secret.metadata.keyId === "string"
        ? bundle.secret.metadata.keyId
        : null;

    if (existingKeyId && bundle?.wrappers?.length) {
      await updateIdentityStatus(existingKeyId);
      return true;
    }

    if (bundle?.secret) {
      try {
        const existingKeys = await getStoredFheKeys();
        if (existingKeys) {
          const { fetchMsgpack } = await import(
            "@/lib/privacy/utils/binary-transport"
          );
          const keyId =
            existingKeys.keyId ||
            (
              await fetchMsgpack<{ keyId: string }>(
                "/api/fhe/keys/register",
                {
                  serverKey: existingKeys.serverKey,
                  publicKey: existingKeys.publicKey,
                },
                { credentials: "include" }
              )
            ).keyId;

          await persistFheKeyId(keyId);
          await updateIdentityStatus(keyId);
          return true;
        }
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "";
        if (
          !(
            message.includes("No credentials are registered") ||
            message.includes("Missing envelope format") ||
            message.includes("Secret envelope format mismatch")
          )
        ) {
          throw loadError;
        }
      }
    }

    return false;
  }, [updateIdentityStatus]);

  const enrollPasskey = useCallback(
    async (userId: string) => {
      if (!hasPasskeys || prfSupported === false) {
        throw new Error("Passkey PRF not available on this device.");
      }

      const passkeys = await listUserPasskeys();
      if (passkeys.error || !passkeys.data?.length) {
        throw new Error("No passkeys registered.");
      }

      setStage("unlocking");
      const prfSalt = generatePrfSalt();
      const signInResult = await signInWithPasskey({
        prfSalt,
        requirePrf: true,
        allowPrfFallback: true,
      });
      if (!signInResult.ok) {
        throw new Error(signInResult.message);
      }
      if (!signInResult.prfOutput) {
        throw new Error("Passkey PRF output missing.");
      }
      if (!signInResult.credentialId) {
        throw new Error("Missing passkey credential ID.");
      }

      setStage("generating");
      const enrollment = await prepareFheKeyEnrollment({
        enrollment: {
          userId,
          credentialId: signInResult.credentialId,
          prfOutput: signInResult.prfOutput,
          prfSalt,
        },
        onStage: (s) =>
          setStage(s === "generate-keys" ? "generating" : "encrypting"),
      });

      const contextResponse = await fetch("/api/fhe-enrollment/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!contextResponse.ok) {
        throw new Error("Failed to create enrollment context.");
      }

      const context = (await contextResponse.json()) as {
        registrationToken?: string;
      };
      if (!context.registrationToken) {
        throw new Error("Missing enrollment registration token.");
      }

      setStage("uploading");
      await uploadSecretBlob({
        secretId: enrollment.secretId,
        secretType: SECRET_TYPES.FHE_KEYS,
        payload: enrollment.encryptedBlob,
        registrationToken: context.registrationToken,
      });

      setStage("registering");
      const registration = await registerFheKeyForEnrollment({
        registrationToken: context.registrationToken,
        publicKeyBytes: enrollment.publicKeyBytes,
        serverKeyBytes: enrollment.serverKeyBytes,
      });

      setStage("finalizing");
      const completeResponse = await fetch("/api/fhe/enrollment/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationToken: context.registrationToken,
          wrappedDek: enrollment.wrappedDek,
          prfSalt: enrollment.prfSalt,
          credentialId: signInResult.credentialId,
          keyId: registration.keyId,
          envelopeFormat: enrollment.envelopeFormat,
        }),
      });
      if (!completeResponse.ok) {
        const body = (await completeResponse.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Failed to complete FHE enrollment.");
      }

      await updateIdentityStatus(registration.keyId);
    },
    [hasPasskeys, prfSupported, updateIdentityStatus]
  );

  const enrollOpaque = useCallback(
    async (userId: string) => {
      if (!password.trim()) {
        throw new Error("Enter your password to continue.");
      }

      setStage("unlocking");
      const result = await authClient.opaque.verifyPassword({ password });
      if (!result.data || result.error) {
        throw new Error(
          result.error?.message || "Password verification failed."
        );
      }

      setStage("generating");
      const { storedKeys } = await generateFheKeyMaterialForStorage();

      setStage("encrypting");
      await storeFheKeysWithCredential({
        keys: storedKeys,
        credential: {
          type: "opaque",
          context: { userId, exportKey: result.data.exportKey },
        },
      });

      setStage("registering");
      const { fetchMsgpack } = await import(
        "@/lib/privacy/utils/binary-transport"
      );
      const registration = await fetchMsgpack<{ keyId: string }>(
        "/api/fhe/keys/register",
        { serverKey: storedKeys.serverKey, publicKey: storedKeys.publicKey },
        { credentials: "include" }
      );

      await persistFheKeyId(registration.keyId);
      await updateIdentityStatus(registration.keyId);
    },
    [password, updateIdentityStatus]
  );

  const enrollNewPassword = useCallback(
    async (userId: string) => {
      if (password.trim().length < 10) {
        throw new Error("Password must be at least 10 characters.");
      }

      setStage("unlocking");
      const result = await authClient.opaque.setPassword({ password });
      if (!result.data || result.error) {
        throw new Error(result.error?.message || "Password creation failed.");
      }

      setStage("generating");
      const { storedKeys } = await generateFheKeyMaterialForStorage();

      setStage("encrypting");
      await storeFheKeysWithCredential({
        keys: storedKeys,
        credential: {
          type: "opaque",
          context: { userId, exportKey: result.data.exportKey },
        },
      });

      setStage("registering");
      const { fetchMsgpack } = await import(
        "@/lib/privacy/utils/binary-transport"
      );
      const registration = await fetchMsgpack<{ keyId: string }>(
        "/api/fhe/keys/register",
        { serverKey: storedKeys.serverKey, publicKey: storedKeys.publicKey },
        { credentials: "include" }
      );

      await persistFheKeyId(registration.keyId);
      await updateIdentityStatus(registration.keyId);
    },
    [password, updateIdentityStatus]
  );

  const enrollWallet = useCallback(
    async (userId: string, walletCtx: WalletContext) => {
      if (!wallet) {
        throw new Error("No wallet linked.");
      }

      setStage("unlocking");
      const typedData = buildKekSignatureTypedData({
        userId,
        chainId: walletCtx.chainId,
      });

      const signArgs = {
        domain: typedData.domain as Record<string, unknown>,
        types: typedData.types as Record<
          string,
          Array<{ name: string; type: string }>
        >,
        primaryType: typedData.primaryType,
        message: typedData.message as Record<string, unknown>,
      };

      const signature1 = await walletCtx.signTypedData(signArgs);
      const signature2 = await walletCtx.signTypedData(signArgs);

      if (signature1 !== signature2) {
        throw new Error(
          "Wallet does not produce deterministic signatures. " +
            "Encryption key wrapping requires a wallet that implements RFC 6979."
        );
      }

      const signatureBytes = signatureToBytes(signature1);
      const signedAt = Math.floor(Date.now() / 1000);
      const expiresAt = signedAt + KEK_SIGNATURE_VALIDITY_DAYS * 24 * 60 * 60;

      setStage("generating");
      const { storedKeys } = await generateFheKeyMaterialForStorage();

      setStage("encrypting");
      await storeFheKeysWithCredential({
        keys: storedKeys,
        credential: {
          type: "wallet",
          context: {
            userId,
            address: walletCtx.address,
            chainId: walletCtx.chainId,
            signatureBytes,
            signedAt,
            expiresAt,
          },
        },
      });

      setStage("registering");
      const { fetchMsgpack } = await import(
        "@/lib/privacy/utils/binary-transport"
      );
      const registration = await fetchMsgpack<{ keyId: string }>(
        "/api/fhe/keys/register",
        { serverKey: storedKeys.serverKey, publicKey: storedKeys.publicKey },
        { credentials: "include" }
      );

      await persistFheKeyId(registration.keyId);
      await updateIdentityStatus(registration.keyId);
    },
    [wallet, updateIdentityStatus]
  );

  const handleEnroll = useCallback(
    async (method: EnrollmentMethod, walletContext?: WalletContext) => {
      if (stage !== "idle") {
        return;
      }

      setError(null);
      setStage("checking");

      try {
        const session = await authClient.getSession();
        const userId = session.data?.user?.id;
        if (!userId) {
          throw new Error("Please sign in to continue.");
        }

        const alreadyEnrolled = await checkExistingEnrollment();
        if (alreadyEnrolled) {
          setStage("done");
          toast.success("Encryption keys already secured.");
          router.refresh();
          onOpenChange(false);
          return;
        }

        if (method === "passkey") {
          await enrollPasskey(userId);
        } else if (method === "password") {
          await enrollOpaque(userId);
        } else if (method === "create-password") {
          await enrollNewPassword(userId);
        } else if (method === "wallet" && walletContext) {
          await enrollWallet(userId, walletContext);
        } else {
          throw new Error("No enrollment method available.");
        }

        setStage("done");
        toast.success("Encryption keys secured.");
        router.refresh();
        onOpenChange(false);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Enrollment failed.";
        const isCancelled =
          message.toLowerCase().includes("cancel") ||
          message.toLowerCase().includes("aborted") ||
          message.toLowerCase().includes("rejected");

        setError(
          isCancelled
            ? "You cancelled the verification step. Try again when ready."
            : message
        );
        setStage("idle");
      }
    },
    [
      stage,
      router,
      onOpenChange,
      checkExistingEnrollment,
      enrollPasskey,
      enrollOpaque,
      enrollNewPassword,
      enrollWallet,
    ]
  );

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStage("idle");
      setError(null);
      setPassword("");
    }
  }, [open]);

  const isRunning = stage !== "idle" && stage !== "done";
  const stageLabel = STAGE_LABELS[stage];
  // Passkey exists but PRF unsupported — offer password creation as fallback
  const needsPasswordFallback =
    availableMethods.length === 0 && hasPasskeys && prfSupported === false;

  return (
    <Dialog onOpenChange={isRunning ? undefined : onOpenChange} open={open}>
      <DialogContent showCloseButton={!isRunning}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ShieldCheck className="h-5 w-5" />
            )}
            {isRunning
              ? "Setting up secure verification..."
              : "Secure your verification"}
          </DialogTitle>
          <DialogDescription>
            {isRunning
              ? stageLabel
              : "Choose how to protect your encryption keys. This is a one-time setup."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isRunning ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="space-y-3">
            {availableMethods.includes("passkey") && (
              <Button
                className="w-full justify-start gap-3"
                disabled={isRunning}
                onClick={() => handleEnroll("passkey").catch(() => undefined)}
                variant="outline"
              >
                <Fingerprint className="h-4 w-4" />
                Continue with Passkey
              </Button>
            )}

            {wallet && availableMethods.includes("wallet") && (
              <WalletEnrollmentButton
                onEnroll={handleEnroll}
                stage={stage}
                wallet={wallet}
              />
            )}

            {availableMethods.includes("password") && (
              <div className="space-y-2">
                <Input
                  autoComplete="current-password"
                  disabled={isRunning}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password.trim()) {
                      handleEnroll("password").catch(() => undefined);
                    }
                  }}
                  placeholder="Enter your password"
                  type="password"
                  value={password}
                />
                <Button
                  className="w-full justify-start gap-3"
                  disabled={isRunning || !password.trim()}
                  onClick={() =>
                    handleEnroll("password").catch(() => undefined)
                  }
                  variant="outline"
                >
                  <KeyRound className="h-4 w-4" />
                  Continue with Password
                </Button>
              </div>
            )}

            {needsPasswordFallback && (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Your passkey doesn't support the encryption extensions needed
                  on this device. Create a password to secure your keys instead.
                </p>
                <Input
                  autoComplete="new-password"
                  disabled={isRunning}
                  minLength={10}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password.trim().length >= 10) {
                      handleEnroll("create-password").catch(() => undefined);
                    }
                  }}
                  placeholder="Create a password (min 10 characters)"
                  type="password"
                  value={password}
                />
                <Button
                  className="w-full justify-start gap-3"
                  disabled={isRunning || password.trim().length < 10}
                  onClick={() =>
                    handleEnroll("create-password").catch(() => undefined)
                  }
                  variant="outline"
                >
                  <KeyRound className="h-4 w-4" />
                  Create Password & Continue
                </Button>
              </div>
            )}

            {availableMethods.length === 0 && !needsPasswordFallback && (
              <p className="text-center text-muted-foreground text-sm">
                No enrollment methods available. Please set up a passkey,
                password, or wallet first.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
