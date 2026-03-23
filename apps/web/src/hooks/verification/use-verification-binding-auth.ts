"use client";

import { useCallback, useState } from "react";

type VerificationBindingAuthMode = "opaque" | "wallet";

/**
 * Shared dialog state for verification flows that need OPAQUE or wallet
 * re-authentication before continuing.
 */
export function useVerificationBindingAuth() {
  const [bindingAuthOpen, setBindingAuthOpen] = useState(false);
  const [bindingAuthMode, setBindingAuthMode] =
    useState<VerificationBindingAuthMode>("opaque");

  const requestBindingAuth = useCallback(
    (mode: VerificationBindingAuthMode) => {
      setBindingAuthMode(mode);
      setBindingAuthOpen(true);
    },
    []
  );

  return {
    bindingAuthMode,
    bindingAuthOpen,
    requestBindingAuth,
    setBindingAuthOpen,
  };
}
