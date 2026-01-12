"use client";

import { useRouter } from "next/navigation";

import { OpaqueChangePasswordSection } from "@/components/dashboard/opaque-change-password-section";
import { SetPasswordSection } from "@/components/dashboard/set-password-section";

interface PasswordSectionProps {
  hasPassword: boolean;
}

/**
 * Wrapper component that shows either:
 * - OpaqueChangePasswordSection (for users with existing password)
 * - SetPasswordSection (custom, for passwordless users to set initial password)
 */
export function PasswordSection({ hasPassword }: PasswordSectionProps) {
  const router = useRouter();

  if (!hasPassword) {
    return <SetPasswordSection onPasswordSet={() => router.refresh()} />;
  }

  return (
    <OpaqueChangePasswordSection onPasswordChanged={() => router.refresh()} />
  );
}
