"use client";

import type { ProofResult, QueryResult } from "@zkpassport/sdk";
import type { FlowStage } from "./status-display";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { BindingAuthDialog } from "@/components/verification/binding-auth-dialog";
import { env } from "@/env";
import { useSession } from "@/lib/auth/auth-client";
import { buildEnrollmentCredential } from "@/lib/privacy/credentials/build-enrollment-credential";
import {
  getCachedBindingMaterial,
  setCachedBindingMaterial,
} from "@/lib/privacy/credentials/cache";
import {
  acquirePasskeyMaterial,
  detectAuthMode,
} from "@/lib/privacy/zk/binding-context";
import { trpc, trpcReact } from "@/lib/trpc/client";

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
  wallet: { address: string; chainId: number } | null;
}

export function ZkPassportFlow({ wallet }: Readonly<ZkPassportFlowProps>) {
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

  // Vault storage state
  const disclosedRef = useRef<DisclosedData | null>(null);
  const [bindingAuthOpen, setBindingAuthOpen] = useState(false);
  const [bindingAuthMode, setBindingAuthMode] = useState<"opaque" | "wallet">(
    "opaque"
  );

  /**
   * Store profile secret in the user's encrypted vault.
   * Returns true if stored (or skipped), false if dialog was opened.
   */
  const storeVault = useCallback(
    async (disclosed: DisclosedData): Promise<boolean> => {
      const userId = session?.user?.id;
      if (!userId) {
        return true;
      }

      let cached = getCachedBindingMaterial();

      if (!cached) {
        const authModeInfo = await detectAuthMode();
        if (!authModeInfo) {
          return true; // No wrappers — skip
        }

        if (authModeInfo.mode === "passkey" && authModeInfo.passkeyCreds) {
          const material = await acquirePasskeyMaterial(
            authModeInfo.passkeyCreds
          );
          if (material) {
            setCachedBindingMaterial(material);
            cached = material;
          }
        } else {
          // OPAQUE or wallet — need dialog for re-auth
          disclosedRef.current = disclosed;
          setBindingAuthMode(authModeInfo.mode as "opaque" | "wallet");
          setBindingAuthOpen(true);
          return false;
        }
      }

      if (!cached) {
        return true;
      }

      const credential = buildEnrollmentCredential(cached, userId, wallet);
      if (!credential) {
        return true;
      }

      try {
        const { storeProfileSecret } = await import(
          "@/lib/privacy/secrets/profile"
        );
        await storeProfileSecret({
          extractedData: {
            extractedFullName: disclosed.fullName,
            extractedDOB: disclosed.dateOfBirth,
            extractedNationality: disclosed.nationality,
            extractedNationalityCode: disclosed.nationalityCode,
            extractedDocumentType: disclosed.documentType,
            extractedDocumentOrigin: disclosed.issuingCountry,
          },
          credential,
        });
      } catch {
        // Non-fatal — vault can be populated at consent time
      }
      return true;
    },
    [session, wallet]
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
        const credential = buildEnrollmentCredential(cached, userId, wallet);
        if (credential) {
          try {
            const { storeProfileSecret } = await import(
              "@/lib/privacy/secrets/profile"
            );
            await storeProfileSecret({
              extractedData: {
                extractedFullName: disclosed.fullName,
                extractedDOB: disclosed.dateOfBirth,
                extractedNationality: disclosed.nationality,
                extractedNationalityCode: disclosed.nationalityCode,
                extractedDocumentType: disclosed.documentType,
                extractedDocumentOrigin: disclosed.issuingCountry,
              },
              credential,
            });
          } catch {
            // Non-fatal
          }
        }
      }
    }

    disclosedRef.current = null;
    setStage("finalizing");
  }, [session, wallet]);

  /**
   * If user closes the dialog without authenticating, proceed anyway.
   * Vault storage is best-effort; consent page has its own unlock.
   */
  const handleBindingAuthOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setBindingAuthOpen(false);
        disclosedRef.current = null;
        if (stage === "verifying") {
          setStage("finalizing");
        }
      }
    },
    [stage]
  );

  const submitResult = trpcReact.passportChip.submitResult.useMutation({
    onSuccess: (data) => {
      storeVault(data.disclosed).then((stored) => {
        // If stored (or skipped), move to finalizing.
        // If dialog was opened (!stored), handleBindingAuthSuccess will transition.
        if (stored) {
          setStage("finalizing");
        }
      });
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
        setStage("success");
        return;
      }

      delay = Math.min(delay * 1.5, FHE_POLL_MAX_MS);
      fhePollRef.current = setTimeout(poll, delay);
    }

    fhePollRef.current = setTimeout(poll, delay);

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

    try {
      const { ZKPassport } = await import("@zkpassport/sdk");
      const zkpassport = new ZKPassport(
        typeof window !== "undefined" ? window.location.hostname : undefined
      );

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
        error instanceof Error ? error.message : "Failed to initialize SDK"
      );
      setStage("error");
    }
  }, [submitResult]);

  // Auto-start on mount — prerequisites are shown on the verify page
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    startFlow();
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
        onNavigate={() => router.push("/dashboard")}
        stage="success"
      />
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
          startFlow();
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
          onSuccess={handleBindingAuthSuccess}
          open={bindingAuthOpen}
          userId={userId}
          wallet={wallet}
        />
      )}
    </div>
  );
}
