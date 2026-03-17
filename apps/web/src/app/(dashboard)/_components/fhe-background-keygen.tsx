"use client";

import { useEffect } from "react";

import { startBackgroundKeygen } from "@/lib/privacy/fhe/background-keygen";

export function FheBackgroundKeygen({
  hasEnrollment,
}: Readonly<{ hasEnrollment: boolean }>) {
  useEffect(() => {
    if (!hasEnrollment) {
      startBackgroundKeygen();
    }
  }, [hasEnrollment]);

  return null;
}
