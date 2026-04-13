"use client";

import type { ProofResult, QueryResult } from "@zkpassport/sdk";
import type { FlowStage } from "./status-display";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { env } from "@/env";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import { useSession } from "@/lib/auth/auth-client";
import {
  buildProfileSecretDataFromPassportDisclosure,
  storeProfileSecretWithMaterial,
} from "@/lib/identity/verification/profile-vault";
import { useVerificationBindingAuth } from "@/lib/identity/verification/state";
import {
  getCachedBindingMaterial,
  setCachedBindingMaterial,
} from "@/lib/privacy/credentials/cache";
import {
  acquirePasskeyMaterial,
  detectAuthMode,
} from "@/lib/privacy/zk/binding-context";
import { trpc, trpcReact } from "@/lib/trpc/client";

import { BindingAuthDialog } from "../binding-auth-dialog";
import { QrDisplay } from "./qr-display";
import { StatusDisplay } from "./status-display";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const FHE_POLL_INITIAL_MS = 2000;
const FHE_POLL_MAX_MS = 8000;
const FHE_POLL_MAX_ATTEMPTS = 20;

interface DisclosedData {
  dateOfBirth: string | null;
  documentType: string | null;
  fullName: string | null;
  issuingCountry: string | null;
  nationality: string | null;
  nationalityCode: string | null;
}

interface ZkPassportFlowProps {
  onComplete?: () => void;
  wallet: { address: string; chainId: number } | null;
}

type VaultStoreOutcome = "stored" | "pending";

/**
 * Override the SDK's client-side verify() to skip expensive WASM proof
 * verification in the browser. The server re-verifies all proofs in
 * passportChip.submitResult, so the client-side check only duplicates
 * work and blocks the main thread.
 *
 * Uses Object.defineProperty because simple assignment may be silently
 * ignored if the bundler emits non-writable prototype descriptors.
 */
function bypassClientProofVerification(zkpassport: object): void {
  Object.defineProperty(zkpassport, "verify", {
    value: async () => ({ verified: true }),
    writable: true,
    configurable: true,
  });
}

export function ZkPassportFlow({
  onComplete,
  wallet,
}: Readonly<ZkPassportFlowProps>) {
  const router = useRouter();
  const { data: session } = useSession();
  const [stage, setStage] = useState<FlowStage>("connecting");
  const [url, setUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [proofsGenerated, setProofsGenerated] = useState(0);
  const [proofsTotal, setProofsTotal] = useState(0);
  const proofsRef = useRef<ProofResult[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const fhePollRef = useRef<ReturnType<typeof setTimeout>>(null);
  const startedRef = useRef(false);
  const vaultSkippedRef = useRef(false);

  // Vault storage state
  const disclosedRef = useRef<DisclosedData | null>(null);
  const {
    bindingAuthMode,
    bindingAuthOpen,
    requestBindingAuth,
    setBindingAuthOpen,
  } = useVerificationBindingAuth();

  const requestVaultRetry = useCallback(
    (disclosed: DisclosedData, message: string) => {
      disclosedRef.current = disclosed;
      toast.warning(message);
      setStage("vault_pending");
    },
    []
  );

  const persistProfileSecret = useCallback(
    async (
      disclosed: DisclosedData,
      cachedBindingMaterial: Parameters<
        typeof storeProfileSecretWithMaterial
      >[0]["cachedBindingMaterial"]
    ) => {
      const userId = session?.user?.id;
      if (!userId) {
        throw new Error(
          "The credential required to encrypt your identity data is unavailable."
        );
      }

      const outcome = await storeProfileSecretWithMaterial({
        cachedBindingMaterial,
        profileData: buildProfileSecretDataFromPassportDisclosure(disclosed),
        userId,
        wallet,
      });

      if (outcome !== "stored") {
        throw new Error(
          "The credential required to encrypt your identity data is unavailable."
        );
      }
    },
    [session, wallet]
  );

  /**
   * Store profile secret in the user's encrypted vault.
   * Returns "stored" when persisted, "pending" when user action is still needed.
   */
  const storeVault = useCallback(
    async (disclosed: DisclosedData): Promise<VaultStoreOutcome> => {
      const userId = session?.user?.id;
      if (!userId) {
        requestVaultRetry(
          disclosed,
          "Your session expired before your identity data could be secured. Sign in again and retry."
        );
        return "pending";
      }

      vaultSkippedRef.current = false;
      let cached = getCachedBindingMaterial();

      if (!cached) {
        const authModeInfo = await detectAuthMode();
        if (!authModeInfo) {
          requestVaultRetry(
            disclosed,
            "No credential is available to encrypt your identity data. Retry after re-authenticating."
          );
          return "pending";
        }

        if (authModeInfo.mode === "passkey" && authModeInfo.passkeyCreds) {
          const material = await acquirePasskeyMaterial(
            authModeInfo.passkeyCreds
          );
          if (material) {
            setCachedBindingMaterial(material);
            cached = material;
          } else {
            requestVaultRetry(
              disclosed,
              "Passkey confirmation was cancelled before your identity data could be saved."
            );
            return "pending";
          }
        } else {
          // OPAQUE or wallet — need dialog for re-auth
          disclosedRef.current = disclosed;
          requestBindingAuth(authModeInfo.mode as "opaque" | "wallet");
          return "pending";
        }
      }

      if (!cached) {
        requestVaultRetry(
          disclosed,
          "The credential required to encrypt your identity data is unavailable. Retry to continue."
        );
        return "pending";
      }

      try {
        await persistProfileSecret(disclosed, cached);
        disclosedRef.current = null;
      } catch (error) {
        console.error("[passport-chip] Profile secret storage failed:", error);
        requestVaultRetry(
          disclosed,
          "Identity data could not be saved to your vault. Retry to enable identity sharing with applications."
        );
        return "pending";
      }
      return "stored";
    },
    [persistProfileSecret, requestBindingAuth, requestVaultRetry, session]
  );

  /**
   * Called when BindingAuthDialog succeeds — credential cache is now populated.
   */
  const handleBindingAuthSuccess = useCallback(async () => {
    setBindingAuthOpen(false);
    const disclosed = disclosedRef.current;
    const userId = session?.user?.id;

    if (disclosed && userId) {
      const cached = getCachedBindingMaterial();
      if (cached) {
        try {
          await persistProfileSecret(disclosed, cached);
          disclosedRef.current = null;
          vaultSkippedRef.current = false;
          setStage("finalizing");
          return;
        } catch (error) {
          console.error(
            "[passport-chip] Profile secret storage failed:",
            error
          );
        }
      }

      requestVaultRetry(
        disclosed,
        "Identity data could not be saved to your vault. Retry to enable identity sharing with applications."
      );
      return;
    }

    setStage("vault_pending");
  }, [persistProfileSecret, requestVaultRetry, session, setBindingAuthOpen]);

  /**
   * If user closes the dialog without authenticating, show vault_pending
   * so they can retry. Preserve disclosedRef so PII isn't garbage-collected.
   */
  const handleBindingAuthOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setBindingAuthOpen(false);
        if (stage === "verifying" && disclosedRef.current) {
          setStage("vault_pending");
        }
      }
    },
    [stage, setBindingAuthOpen]
  );

  const handleRetryVault = useCallback(() => {
    const disclosed = disclosedRef.current;
    if (disclosed) {
      storeVault(disclosed)
        .then((stored) => {
          if (stored === "stored") {
            setStage("finalizing");
          }
        })
        .catch(reportRejection);
    }
  }, [storeVault]);

  const handleSkipVault = useCallback(() => {
    vaultSkippedRef.current = true;
    setBindingAuthOpen(false);
    disclosedRef.current = null;
    setStage("finalizing");
  }, [setBindingAuthOpen]);

  const submitResult = trpcReact.passportChip.submitResult.useMutation({
    onSuccess: (data) => {
      storeVault(data.disclosed)
        .then((stored) => {
          // A successful vault write can move straight into finalizing.
          // Pending states keep the user in the vault flow until they retry or skip.
          if (stored === "stored") {
            setStage("finalizing");
          }
        })
        .catch(reportRejection);
    },
    onError: (error: { message: string }) => {
      setErrorMessage(error.message);
      setStage("error");
    },
  });

  // Poll FHE status during "finalizing" stage
  useEffect(() => {
    if (stage !== "finalizing") {
      return;
    }

    let attempt = 0;
    let delay = FHE_POLL_INITIAL_MS;
    let cancelled = false;

    async function poll() {
      if (cancelled) {
        return;
      }
      attempt++;

      try {
        const status = await trpc.passportChip.status.query();

        if (cancelled) {
          return;
        }

        if (!(status.profileSecretStored || vaultSkippedRef.current)) {
          setStage("vault_pending");
          return;
        }

        if (status.fheComplete) {
          setStage("success");
          return;
        }

        if (status.fheError) {
          setErrorMessage(
            `Encryption failed: ${status.fheError}. Please try again.`
          );
          setStage("error");
          return;
        }
      } catch {
        // Network errors are non-fatal, keep polling
      }

      if (attempt >= FHE_POLL_MAX_ATTEMPTS) {
        if (vaultSkippedRef.current) {
          setStage("success");
        } else {
          setStage("vault_pending");
        }
        return;
      }

      delay = Math.min(delay * 1.5, FHE_POLL_MAX_MS);
      fhePollRef.current = setTimeout(() => {
        poll().catch(reportRejection);
      }, delay);
    }

    fhePollRef.current = setTimeout(() => {
      poll().catch(reportRejection);
    }, delay);

    return () => {
      cancelled = true;
      if (fhePollRef.current) {
        clearTimeout(fhePollRef.current);
      }
    };
  }, [stage]);

  const startFlow = useCallback(async () => {
    setStage("connecting");
    setErrorMessage(null);
    setProofsGenerated(0);
    setProofsTotal(0);
    proofsRef.current = [];
    disclosedRef.current = null;
    vaultSkippedRef.current = false;
    setBindingAuthOpen(false);

    try {
      const { ZKPassport } = await import("@zkpassport/sdk");
      const zkpassport = new ZKPassport(
        typeof window === "undefined" ? undefined : window.location.hostname
      );
      bypassClientProofVerification(zkpassport);

      const isDevMode =
        env.NEXT_PUBLIC_APP_ENV === "development" ||
        env.NEXT_PUBLIC_APP_ENV === "test";

      const qb = await zkpassport.request({
        name: "Zentity",
        logo: `${env.NEXT_PUBLIC_APP_URL}/icon.png`,
        purpose:
          "Verify your document for the highest level of identity assurance",
        devMode: isDevMode,
      });

      let builder = qb
        .gte("age", 18)
        .disclose("birthdate")
        .disclose("nationality")
        .disclose("fullname")
        .disclose("document_type")
        .disclose("issuing_country")
        .sanctions("all", "all");

      try {
        builder = builder.facematch("strict");
      } catch {
        // Face match not available for this document — continue without it
      }

      const request = builder.done();

      setUrl(request.url);

      timeoutRef.current = setTimeout(() => {
        setStage("timeout");
      }, TIMEOUT_MS);

      request.onRequestReceived(() => {
        setStage("scanning");
      });

      request.onGeneratingProof(() => {
        setStage("generating");
      });

      request.onProofGenerated((proof: ProofResult) => {
        proofsRef.current.push(proof);
        setProofsGenerated((prev) => prev + 1);
        if (proof.total) {
          setProofsTotal(proof.total);
        }
      });

      request.onResult(
        (response: {
          uniqueIdentifier: string | undefined;
          verified: boolean;
          result: QueryResult;
        }) => {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }

          if (!response.verified) {
            setErrorMessage(
              "Verification failed. The proofs could not be verified."
            );
            setStage("error");
            return;
          }

          setStage("verifying");

          submitResult.mutate({
            requestId: request.requestId,
            proofs: proofsRef.current as Record<string, unknown>[],
            result: response.result as unknown as Record<string, unknown>,
          });
        }
      );

      request.onReject(() => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        setErrorMessage("Request was rejected in the ZKPassport app.");
        setStage("error");
      });

      request.onError((error: string) => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        setErrorMessage(error);
        setStage("error");
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong loading the verification app. Please refresh and try again."
      );
      setStage("error");
    }
  }, [submitResult, setBindingAuthOpen]);

  // Auto-start on mount — prerequisites are shown on the verify page
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    startFlow().catch(reportRejection);
  }, [startFlow]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (fhePollRef.current) {
        clearTimeout(fhePollRef.current);
      }
    };
  }, []);

  const userId = session?.user?.id;

  if (stage === "success") {
    return (
      <StatusDisplay
        onNavigate={() => {
          if (onComplete) {
            onComplete();
          } else {
            router.push("/dashboard");
          }
        }}
        stage="success"
      />
    );
  }

  if (stage === "vault_pending") {
    return (
      <div className="space-y-6">
        <StatusDisplay
          onRetryVault={handleRetryVault}
          onSkipVault={handleSkipVault}
          stage="vault_pending"
        />
        {userId && (
          <BindingAuthDialog
            authMode={bindingAuthMode}
            onOpenChange={handleBindingAuthOpenChange}
            onSuccess={asyncHandler(handleBindingAuthSuccess)}
            open={bindingAuthOpen}
            userId={userId}
            wallet={wallet}
          />
        )}
      </div>
    );
  }

  if (stage === "error" || stage === "timeout") {
    return (
      <StatusDisplay
        errorMessage={errorMessage}
        onRetry={() => {
          startedRef.current = false;
          setUrl(null);
          setErrorMessage(null);
          startFlow().catch(reportRejection);
        }}
        stage={stage}
      />
    );
  }

  return (
    <div className="space-y-6">
      <StatusDisplay
        proofsGenerated={proofsGenerated}
        proofsTotal={proofsTotal}
        stage={stage}
      />
      {url && stage === "connecting" && <QrDisplay url={url} />}

      {userId && (
        <BindingAuthDialog
          authMode={bindingAuthMode}
          onOpenChange={handleBindingAuthOpenChange}
          onSuccess={asyncHandler(handleBindingAuthSuccess)}
          open={bindingAuthOpen}
          userId={userId}
          wallet={wallet}
        />
      )}
    </div>
  );
}
