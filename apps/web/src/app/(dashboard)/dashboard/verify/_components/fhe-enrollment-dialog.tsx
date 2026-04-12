"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Fingerprint, KeyRound, Loader2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useChainId, useSignTypedData } from "wagmi";

import { Web3Provider } from "@/components/providers/web3-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { recordClientMetric } from "@/lib/observability/client-metrics";
import { setCachedBindingMaterial } from "@/lib/privacy/credentials/cache";
import { generatePrfSalt } from "@/lib/privacy/credentials/derivation";
import {
  buildKekSignatureTypedData,
  signatureToBytes,
} from "@/lib/privacy/credentials/wallet";
import {
  getPreGeneratedKeys,
  startBackgroundKeygen,
} from "@/lib/privacy/fhe/background-keygen";
import { generateFheKeyMaterialForStorage } from "@/lib/privacy/fhe/client";
import { prewarmTfheWorker } from "@/lib/privacy/fhe/keygen-client";
import {
  getStoredFheKeys,
  persistFheKeyId,
  storeFheKeysWithCredential,
} from "@/lib/privacy/fhe/store";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
import {
  deriveBindingSecret,
  prepareBindingProofInputs,
} from "@/lib/privacy/zk/binding-secret";
import { generateBaseCommitment } from "@/lib/privacy/zk/client";
import { AuthMode } from "@/lib/privacy/zk/proof-types";
import { trpc } from "@/lib/trpc/client";
import { fetchMsgpack } from "@/lib/utils/binary-transport";

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
  checking: "Checking for existing keys...",
  unlocking: "Confirming your identity...",
  generating: "Generating encryption keys (this may take up to a minute)...",
  encrypting: "Encrypting keys on your device...",
  uploading: "Storing encrypted keys...",
  registering: "Connecting to the encryption service...",
  finalizing: "Finishing setup...",
  done: "Ready!",
};

const KEK_SIGNATURE_VALIDITY_DAYS = 365;

function formatEnrollmentError(message: string): string {
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage === "failed to fetch" ||
    lowerMessage.includes("zk proof generation timed out") ||
    lowerMessage.includes("failed to load noir wasm") ||
    lowerMessage.includes("failed to compile bb wasm")
  ) {
    return "Could not load the local verification assets needed to set up encryption keys. Refresh the page and try again.";
  }

  return message;
}

interface FheEnrollmentDialogProps {
  hasPasskeys: boolean;
  hasPassword: boolean;
  inline?: boolean;
  onComplete?: () => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
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
  address: string;
  chainId: number;
  signTypedData: (args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<string>;
}

export function FheEnrollmentDialog({
  open = true,
  onOpenChange,
  inline,
  onComplete,
  hasPasskeys,
  hasPassword,
  wallet,
}: Readonly<FheEnrollmentDialogProps>) {
  const router = useRouter();
  const [stage, setStage] = useState<EnrollmentStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);

  const timingRef = useRef<{
    method: string;
    totalStart: number;
    lastAt: number;
    currentStage: EnrollmentStage;
  } | null>(null);

  const advanceStage = useCallback((next: EnrollmentStage) => {
    const timing = timingRef.current;
    if (timing && timing.currentStage !== next) {
      const now = performance.now();
      recordClientMetric({
        name: "client.fhe.enrollment.stage.duration",
        value: now - timing.lastAt,
        attributes: { stage: timing.currentStage, method: timing.method },
      });
      timing.lastAt = now;
      timing.currentStage = next;
    }
    setStage(next);
  }, []);

  const finishTiming = useCallback((result: "ok" | "error") => {
    const timing = timingRef.current;
    if (!timing) {
      return;
    }
    const now = performance.now();
    recordClientMetric({
      name: "client.fhe.enrollment.stage.duration",
      value: now - timing.lastAt,
      attributes: {
        stage: timing.currentStage,
        method: timing.method,
        result,
      },
    });
    recordClientMetric({
      name: "client.fhe.enrollment.total.duration",
      value: now - timing.totalStart,
      attributes: { method: timing.method, result },
    });
    timingRef.current = null;
  }, []);

  useEffect(() => {
    if (inline) {
      startBackgroundKeygen();
    }
  }, [inline]);

  useEffect(() => {
    if (inline || open) {
      prewarmTfheWorker();
      checkPrfSupport().then((r) => setPrfSupported(r.supported));
    }
  }, [inline, open]);

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
    const response = await fetch("/api/fhe/status", {
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
          const { fetchMsgpack } = await import("@/lib/utils/binary-transport");
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

          await persistFheKeyId(keyId, existingKeys.publicKeyFingerprint);
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
        throw new Error(
          "This passkey doesn't support the encryption features needed. Please try a different passkey or use a password instead."
        );
      }

      const passkeys = await listUserPasskeys();
      if (passkeys.error || !passkeys.data?.length) {
        throw new Error("No passkeys registered.");
      }

      advanceStage("unlocking");
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
        throw new Error(
          "Your passkey didn't return the expected data. Please try again or use a different sign-in method."
        );
      }
      if (!signInResult.credentialId) {
        throw new Error("Missing passkey credential ID.");
      }

      const credentialId = signInResult.credentialId;
      const prfOutput = signInResult.prfOutput;

      setCachedBindingMaterial({
        mode: "passkey",
        prfOutput,
        credentialId,
        prfSalt,
      });

      advanceStage("generating");
      const preGenerated = await getPreGeneratedKeys();
      let storedKeys: Awaited<
        ReturnType<typeof generateFheKeyMaterialForStorage>
      >["storedKeys"];
      let fingerprint: string;
      if (preGenerated) {
        storedKeys = preGenerated.storedKeys;
        fingerprint = preGenerated.publicKeyFingerprint;
      } else {
        const generated = await generateFheKeyMaterialForStorage();
        storedKeys = generated.storedKeys;
        fingerprint = generated.publicKeyFingerprint;
      }

      const secretParams = await deriveBindingSecret({
        authMode: AuthMode.PASSKEY,
        userId,
        documentHash: "0x00",
        prfOutput,
      });
      const proofInputs = prepareBindingProofInputs(secretParams);
      const baseCommitment = await generateBaseCommitment(
        proofInputs.bindingSecretField,
        proofInputs.userIdHashField
      );

      advanceStage("encrypting");
      await storeFheKeysWithCredential({
        keys: storedKeys,
        credential: {
          type: "passkey",
          context: { userId, credentialId, prfOutput, prfSalt },
        },
        baseCommitment,
      });

      advanceStage("registering");
      const keyId = preGenerated
        ? preGenerated.keyId
        : (
            await fetchMsgpack<{ keyId: string }>(
              "/api/fhe/keys/register",
              {
                serverKey: storedKeys.serverKey,
                publicKey: storedKeys.publicKey,
              },
              { credentials: "include" }
            )
          ).keyId;

      await persistFheKeyId(keyId, fingerprint);
      await updateIdentityStatus(keyId);
    },
    [hasPasskeys, prfSupported, updateIdentityStatus, advanceStage]
  );

  const enrollOpaque = useCallback(
    async (userId: string) => {
      if (!password.trim()) {
        throw new Error("Enter your password to continue.");
      }

      advanceStage("unlocking");
      const opaqueStart = performance.now();
      const result = await authClient.opaque.verifyPassword({ password });
      recordClientMetric({
        name: "client.opaque.duration",
        value: performance.now() - opaqueStart,
        attributes: { result: result.error ? "error" : "ok" },
      });
      if (!result.data || result.error) {
        throw new Error(
          result.error?.message || "Password verification failed."
        );
      }

      setCachedBindingMaterial({
        mode: "opaque",
        exportKey: result.data.exportKey,
      });

      advanceStage("generating");
      const preGenerated = await getPreGeneratedKeys();
      let storedKeys: Awaited<
        ReturnType<typeof generateFheKeyMaterialForStorage>
      >["storedKeys"];
      let fingerprint: string;
      if (preGenerated) {
        storedKeys = preGenerated.storedKeys;
        fingerprint = preGenerated.publicKeyFingerprint;
      } else {
        const generated = await generateFheKeyMaterialForStorage();
        storedKeys = generated.storedKeys;
        fingerprint = generated.publicKeyFingerprint;
      }

      const secretParams = await deriveBindingSecret({
        authMode: AuthMode.OPAQUE,
        userId,
        documentHash: "0x00",
        exportKey: result.data.exportKey,
      });
      const proofInputs = prepareBindingProofInputs(secretParams);
      const baseCommitment = await generateBaseCommitment(
        proofInputs.bindingSecretField,
        proofInputs.userIdHashField
      );

      advanceStage("encrypting");
      await storeFheKeysWithCredential({
        keys: storedKeys,
        credential: {
          type: "opaque",
          context: { userId, exportKey: result.data.exportKey },
        },
        baseCommitment,
      });

      advanceStage("registering");
      const keyId = preGenerated
        ? preGenerated.keyId
        : await (async () => {
            const { fetchMsgpack } = await import(
              "@/lib/utils/binary-transport"
            );
            return (
              await fetchMsgpack<{ keyId: string }>(
                "/api/fhe/keys/register",
                {
                  serverKey: storedKeys.serverKey,
                  publicKey: storedKeys.publicKey,
                },
                { credentials: "include" }
              )
            ).keyId;
          })();

      await persistFheKeyId(keyId, fingerprint);
      await updateIdentityStatus(keyId);
    },
    [password, updateIdentityStatus, advanceStage]
  );

  const enrollNewPassword = useCallback(
    async (userId: string) => {
      if (password.trim().length < 10) {
        throw new Error("Password must be at least 10 characters.");
      }

      advanceStage("unlocking");
      const opaqueStart = performance.now();
      const result = await authClient.opaque.setPassword({ password });
      recordClientMetric({
        name: "client.opaque.duration",
        value: performance.now() - opaqueStart,
        attributes: { result: result.error ? "error" : "ok" },
      });
      if (!result.data || result.error) {
        throw new Error(result.error?.message || "Password creation failed.");
      }

      setCachedBindingMaterial({
        mode: "opaque",
        exportKey: result.data.exportKey,
      });

      advanceStage("generating");
      const preGeneratedNew = await getPreGeneratedKeys();
      let storedKeysNew: Awaited<
        ReturnType<typeof generateFheKeyMaterialForStorage>
      >["storedKeys"];
      let fingerprintNew: string;
      if (preGeneratedNew) {
        storedKeysNew = preGeneratedNew.storedKeys;
        fingerprintNew = preGeneratedNew.publicKeyFingerprint;
      } else {
        const generated = await generateFheKeyMaterialForStorage();
        storedKeysNew = generated.storedKeys;
        fingerprintNew = generated.publicKeyFingerprint;
      }

      const secretParams = await deriveBindingSecret({
        authMode: AuthMode.OPAQUE,
        userId,
        documentHash: "0x00",
        exportKey: result.data.exportKey,
      });
      const proofInputs = prepareBindingProofInputs(secretParams);
      const baseCommitment = await generateBaseCommitment(
        proofInputs.bindingSecretField,
        proofInputs.userIdHashField
      );

      advanceStage("encrypting");
      await storeFheKeysWithCredential({
        keys: storedKeysNew,
        credential: {
          type: "opaque",
          context: { userId, exportKey: result.data.exportKey },
        },
        baseCommitment,
      });

      advanceStage("registering");
      const keyId = preGeneratedNew
        ? preGeneratedNew.keyId
        : await (async () => {
            const { fetchMsgpack } = await import(
              "@/lib/utils/binary-transport"
            );
            return (
              await fetchMsgpack<{ keyId: string }>(
                "/api/fhe/keys/register",
                {
                  serverKey: storedKeysNew.serverKey,
                  publicKey: storedKeysNew.publicKey,
                },
                { credentials: "include" }
              )
            ).keyId;
          })();

      await persistFheKeyId(keyId, fingerprintNew);
      await updateIdentityStatus(keyId);
    },
    [password, updateIdentityStatus, advanceStage]
  );

  const enrollWallet = useCallback(
    async (userId: string, walletCtx: WalletContext) => {
      if (!wallet) {
        throw new Error("No wallet linked.");
      }

      advanceStage("unlocking");
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

      const walletSignStart = performance.now();
      const signature1 = await walletCtx.signTypedData(signArgs);
      const signature2 = await walletCtx.signTypedData(signArgs);
      recordClientMetric({
        name: "client.wallet.sign.duration",
        value: performance.now() - walletSignStart,
        attributes: { result: "ok" },
      });

      if (signature1 !== signature2) {
        throw new Error(
          "This wallet produced inconsistent signatures. Please use a different wallet or sign in with a passkey or password."
        );
      }

      const signatureBytes = signatureToBytes(signature1);

      setCachedBindingMaterial({ mode: "wallet", signatureBytes });

      const signedAt = Math.floor(Date.now() / 1000);
      const expiresAt = signedAt + KEK_SIGNATURE_VALIDITY_DAYS * 24 * 60 * 60;

      advanceStage("generating");
      const preGeneratedWallet = await getPreGeneratedKeys();
      let storedKeysWallet: Awaited<
        ReturnType<typeof generateFheKeyMaterialForStorage>
      >["storedKeys"];
      let fingerprintWallet: string;
      if (preGeneratedWallet) {
        storedKeysWallet = preGeneratedWallet.storedKeys;
        fingerprintWallet = preGeneratedWallet.publicKeyFingerprint;
      } else {
        const generated = await generateFheKeyMaterialForStorage();
        storedKeysWallet = generated.storedKeys;
        fingerprintWallet = generated.publicKeyFingerprint;
      }

      const secretParams = await deriveBindingSecret({
        authMode: AuthMode.WALLET,
        userId,
        documentHash: "0x00",
        signatureBytes,
      });
      const proofInputs = prepareBindingProofInputs(secretParams);
      const baseCommitment = await generateBaseCommitment(
        proofInputs.bindingSecretField,
        proofInputs.userIdHashField
      );

      advanceStage("encrypting");
      await storeFheKeysWithCredential({
        keys: storedKeysWallet,
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
        baseCommitment,
      });

      advanceStage("registering");
      const keyId = preGeneratedWallet
        ? preGeneratedWallet.keyId
        : await (async () => {
            const { fetchMsgpack } = await import(
              "@/lib/utils/binary-transport"
            );
            return (
              await fetchMsgpack<{ keyId: string }>(
                "/api/fhe/keys/register",
                {
                  serverKey: storedKeysWallet.serverKey,
                  publicKey: storedKeysWallet.publicKey,
                },
                { credentials: "include" }
              )
            ).keyId;
          })();

      await persistFheKeyId(keyId, fingerprintWallet);
      await updateIdentityStatus(keyId);
    },
    [wallet, updateIdentityStatus, advanceStage]
  );

  const handleEnroll = useCallback(
    async (method: EnrollmentMethod, walletContext?: WalletContext) => {
      if (stage !== "idle") {
        return;
      }

      setError(null);
      const now = performance.now();
      timingRef.current = {
        method,
        totalStart: now,
        lastAt: now,
        currentStage: "checking",
      };
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
          if (onComplete) {
            onComplete();
          } else {
            router.refresh();
            onOpenChange?.(false);
          }
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
          throw new Error(
            "No sign-in method available for setup. Please set up a passkey, password, or wallet first."
          );
        }

        finishTiming("ok");
        setStage("done");
        toast.success("Encryption keys secured.");
        if (onComplete) {
          onComplete();
        } else {
          router.refresh();
          onOpenChange?.(false);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Enrollment failed.";
        const isCancelled =
          message.toLowerCase().includes("cancel") ||
          message.toLowerCase().includes("aborted") ||
          message.toLowerCase().includes("rejected");

        finishTiming("error");
        setError(
          isCancelled
            ? "Key setup was cancelled. Try again when ready."
            : formatEnrollmentError(message)
        );
        setStage("idle");
      }
    },
    [
      stage,
      router,
      onComplete,
      onOpenChange,
      checkExistingEnrollment,
      enrollPasskey,
      enrollOpaque,
      enrollNewPassword,
      enrollWallet,
      finishTiming,
    ]
  );

  useEffect(() => {
    if (!(inline || open)) {
      setStage("idle");
      setError(null);
      setPassword("");
    }
  }, [inline, open]);

  const isRunning = stage !== "idle" && stage !== "done";
  const stageLabel = STAGE_LABELS[stage];
  // Passkey exists but PRF unsupported — offer password creation as fallback
  const needsPasswordFallback =
    availableMethods.length === 0 && hasPasskeys && prfSupported === false;

  const title = isRunning
    ? "Setting up encryption keys..."
    : "Set up encryption keys";

  const description = isRunning
    ? stageLabel
    : "Before verification, we need to generate your personal encryption keys. This is a one-time setup that can take up to a minute depending on your device.";

  const titleIcon = isRunning ? (
    <Loader2 className="h-5 w-5 animate-spin" />
  ) : (
    <KeyRound className="h-5 w-5" />
  );

  const body = (
    <>
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
                onClick={() => handleEnroll("password").catch(() => undefined)}
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
                Your passkey doesn't support the encryption extensions needed on
                this device. Create a password to secure your keys instead.
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
              No sign-in methods available. Please set up a passkey, password,
              or wallet first.
            </p>
          )}
        </div>
      )}
    </>
  );

  if (inline) {
    const card = (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {titleIcon}
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    );

    return wallet ? <Web3Provider cookies={null}>{card}</Web3Provider> : card;
  }

  return (
    <Dialog {...(isRunning ? {} : { onOpenChange })} open={open}>
      <DialogContent showCloseButton={!isRunning}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {titleIcon}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
