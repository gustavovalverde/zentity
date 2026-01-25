"use client";

import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/lib/auth/auth-client";
import {
  hasCachedPasskeyUnlock,
  isOpaqueCacheFresh,
  isWalletCacheFresh,
  OPAQUE_CREDENTIAL_ID,
  parseWalletCredentialId,
  WALLET_CREDENTIAL_PREFIX,
} from "@/lib/privacy/credentials";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
import { trpc } from "@/lib/trpc/client";
import { base64ToBytes } from "@/lib/utils/base64";

export type AuthMode = "passkey" | "opaque" | "wallet";

export type AuthMaterialStatus =
  | { status: "checking" }
  | { status: "fresh"; authMode: AuthMode }
  | {
      status: "expired";
      authMode: AuthMode;
      walletInfo?: { address: string; chainId: number };
      passkeyCreds?: { credentialId: string; prfSalt: Uint8Array }[];
    }
  | { status: "no_wrappers" }
  | { status: "error"; message: string };

interface UseAuthMaterialStatusResult {
  authStatus: AuthMaterialStatus;
  recheckStatus: () => Promise<void>;
  userId: string | null;
}

/**
 * Hook to check auth material cache freshness before starting verification.
 * Detects auth mode from secret wrappers and verifies cache validity.
 */
export function useAuthMaterialStatus(): UseAuthMaterialStatusResult {
  const [authStatus, setAuthStatus] = useState<AuthMaterialStatus>({
    status: "checking",
  });
  const [userId, setUserId] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setAuthStatus({ status: "checking" });

    try {
      const session = await authClient.getSession();
      const currentUserId = session.data?.user?.id ?? null;

      if (!currentUserId) {
        setAuthStatus({ status: "error", message: "Not authenticated" });
        return;
      }

      setUserId(currentUserId);

      const bundle = await trpc.secrets.getSecretBundle.query({
        secretType: SECRET_TYPES.FHE_KEYS,
      });

      if (!bundle?.wrappers?.length) {
        setAuthStatus({ status: "no_wrappers" });
        return;
      }

      // Priority: passkey > OPAQUE > wallet (matches loadSecret order)
      const passkeyCreds = bundle.wrappers.flatMap((w) =>
        w.prfSalt
          ? [
              {
                credentialId: w.credentialId,
                prfSalt: base64ToBytes(w.prfSalt),
              },
            ]
          : []
      );

      if (passkeyCreds.length > 0) {
        const isFresh = hasCachedPasskeyUnlock();
        if (isFresh) {
          setAuthStatus({ status: "fresh", authMode: "passkey" });
        } else {
          setAuthStatus({
            status: "expired",
            authMode: "passkey",
            passkeyCreds,
          });
        }
        return;
      }

      const opaqueWrapper = bundle.wrappers.find(
        (w) => w.credentialId === OPAQUE_CREDENTIAL_ID
      );

      if (opaqueWrapper) {
        const isFresh = isOpaqueCacheFresh(currentUserId);
        if (isFresh) {
          setAuthStatus({ status: "fresh", authMode: "opaque" });
        } else {
          setAuthStatus({ status: "expired", authMode: "opaque" });
        }
        return;
      }

      const walletWrapper = bundle.wrappers.find((w) =>
        w.credentialId.startsWith(WALLET_CREDENTIAL_PREFIX)
      );

      if (walletWrapper) {
        const parsed = parseWalletCredentialId(walletWrapper.credentialId);
        if (parsed) {
          const isFresh = isWalletCacheFresh(
            currentUserId,
            parsed.address,
            parsed.chainId
          );
          if (isFresh) {
            setAuthStatus({ status: "fresh", authMode: "wallet" });
          } else {
            setAuthStatus({
              status: "expired",
              authMode: "wallet",
              walletInfo: { address: parsed.address, chainId: parsed.chainId },
            });
          }
          return;
        }
      }

      setAuthStatus({ status: "no_wrappers" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to check auth status";
      setAuthStatus({ status: "error", message });
    }
  }, []);

  useEffect(() => {
    checkStatus().catch(() => undefined);
  }, [checkStatus]);

  return { authStatus, recheckStatus: checkStatus, userId };
}
