"use client";

import { ChangePasswordCard } from "@daveyplate/better-auth-ui";
import { useRouter } from "next/navigation";

import { SetPasswordSection } from "@/components/dashboard/set-password-section";

interface PasswordSectionProps {
  hasPassword: boolean;
}

/**
 * Wrapper component that shows either:
 * - ChangePasswordCard from Better Auth UI (for users with existing password)
 * - SetPasswordSection (custom, for passwordless users to set initial password)
 */
export function PasswordSection({ hasPassword }: PasswordSectionProps) {
  const router = useRouter();

  if (!hasPassword) {
    return <SetPasswordSection onPasswordSet={() => router.refresh()} />;
  }

  return (
    <ChangePasswordCard
      localization={{
        CHANGE_PASSWORD: "Change Password",
        CHANGE_PASSWORD_DESCRIPTION:
          "Update your password to keep your account secure",
      }}
    />
  );
}
